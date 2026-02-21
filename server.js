const express = require("express");
const { Pool } = require("pg");
const redis = require("redis");
const cors = require("cors");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());

// Redis client (non-blocking — app works without Redis)
const redisClient = redis.createClient({
  socket: {
    host: process.env.REDIS_HOST || "redis",
    port: parseInt(process.env.REDIS_PORT || "6379"),
  },
});
redisClient.on("error", (err) => console.warn("Redis error (non-fatal):", err.message));
redisClient.connect().catch((err) => console.warn("Redis connect failed (non-fatal):", err.message));

// Serve built frontend
app.use(express.static(path.join(__dirname, "client/dist")));

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "postgres",
  port: parseInt(process.env.POSTGRES_PORT || "5432"),
  user: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD || "postgres",
  database: process.env.POSTGRES_DB || "postgres",
});

// Run migrations on startup
async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        preferred_language VARCHAR(10) DEFAULT 'sv'
      );

      CREATE TABLE IF NOT EXISTS merchants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        user_id UUID,
        location VARCHAR(255) NOT NULL DEFAULT 'Stockholm',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        price DECIMAL NOT NULL,
        type VARCHAR(50) NOT NULL DEFAULT 'Meal',
        dietary_restrictions VARCHAR(255),
        available_quantity INTEGER NOT NULL DEFAULT 0,
        best_before_date TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID,
        total DECIMAL NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
        item_id UUID REFERENCES items(id),
        quantity INTEGER NOT NULL DEFAULT 1,
        price DECIMAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_items_merchant_id ON items(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
    `);

    // Seed a demo merchant if none exist
    const { rows } = await client.query("SELECT COUNT(*) FROM merchants");
    if (parseInt(rows[0].count) === 0) {
      const m = await client.query(
        "INSERT INTO merchants (name, location) VALUES ($1, $2) RETURNING id",
        ["Demo Bageri AB", "Södermalm, Stockholm"]
      );
      const mid = m.rows[0].id;
      await client.query(
        `INSERT INTO items (merchant_id, name, price, type, dietary_restrictions, available_quantity, best_before_date)
         VALUES
           ($1, 'Surprise Bag', 49, 'Surprise Bag', 'Mixed', 5, NOW() + interval '6 hours'),
           ($1, 'Day-old Sourdough', 18, 'Bakery', 'Vegetarian', 8, NOW() + interval '12 hours'),
           ($1, 'Lunch Leftovers', 35, 'Meal', 'Contains gluten', 3, NOW() + interval '4 hours'),
           ($1, 'Mixed Groceries', 59, 'Grocery', 'Vegan', 2, NOW() + interval '24 hours')`,
        [mid]
      );
    }
    console.log("Migration complete");
  } catch (err) {
    console.error("Migration error:", err.message);
  } finally {
    client.release();
  }
}

// Health check (SAAC standard endpoint)
const startTime = Date.now();
app.get("/health", (req, res) => res.json({
  status: "ok",
  commit: process.env.SOURCE_COMMIT || "unknown",
  uptime: Math.floor((Date.now() - startTime) / 1000),
  timestamp: new Date()
}));

// API health check — verifies DB and Redis connectivity
app.get("/api/health", async (req, res) => {
  const checks = { db: "unknown", redis: "unknown" };

  try {
    await pool.query("SELECT 1");
    checks.db = "ok";
  } catch (e) {
    checks.db = "error";
  }

  try {
    if (redisClient.isReady) {
      await redisClient.ping();
      checks.redis = "ok";
    } else {
      checks.redis = "unavailable";
    }
  } catch (e) {
    checks.redis = "error";
  }

  const allOk = checks.db === "ok";
  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ok" : "degraded",
    service: "reddamaten-api",
    commit: process.env.SOURCE_COMMIT || "unknown",
    uptime: Math.floor((Date.now() - startTime) / 1000),
    checks,
    timestamp: new Date()
  });
});

// GET /api/items — all available items with merchant info
app.get("/api/items", async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT i.*, m.name AS merchant_name, m.location AS merchant_location
      FROM items i
      JOIN merchants m ON m.id = i.merchant_id
      WHERE i.available_quantity > 0
      ORDER BY i.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/orders — reserve an item
app.post("/api/orders", async (req, res) => {
  const { item_id, quantity = 1 } = req.body;
  if (!item_id) return res.status(400).json({ error: "item_id required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [item] } = await client.query(
      "SELECT * FROM items WHERE id = $1 FOR UPDATE", [item_id]
    );
    if (!item) return res.status(404).json({ error: "Item not found" });
    if (item.available_quantity < quantity) return res.status(409).json({ error: "Not enough stock" });

    const { rows: [order] } = await client.query(
      "INSERT INTO orders (total, status) VALUES ($1, 'pending') RETURNING id",
      [item.price * quantity]
    );
    await client.query(
      "INSERT INTO order_items (order_id, item_id, quantity, price) VALUES ($1, $2, $3, $4)",
      [order.id, item_id, quantity, item.price]
    );
    await client.query(
      "UPDATE items SET available_quantity = available_quantity - $1 WHERE id = $2",
      [quantity, item_id]
    );
    await client.query("COMMIT");
    res.json({ order_id: order.id, message: "Reserved" });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// GET /api/merchant/items — merchant's own listings (demo: first merchant)
app.get("/api/merchant/items", async (req, res) => {
  try {
    const { rows: [merchant] } = await pool.query("SELECT id FROM merchants LIMIT 1");
    if (!merchant) return res.json([]);
    const { rows } = await pool.query(
      "SELECT * FROM items WHERE merchant_id = $1 ORDER BY created_at DESC",
      [merchant.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/merchant/items — add a listing
app.post("/api/merchant/items", async (req, res) => {
  const { name, type, price, dietary_restrictions, available_quantity, best_before_date } = req.body;
  if (!name || !price || !available_quantity) {
    return res.status(400).json({ error: "name, price, and available_quantity are required" });
  }
  try {
    const { rows: [merchant] } = await pool.query("SELECT id FROM merchants LIMIT 1");
    if (!merchant) return res.status(404).json({ error: "No merchant found" });
    const { rows: [item] } = await pool.query(
      `INSERT INTO items (merchant_id, name, type, price, dietary_restrictions, available_quantity, best_before_date)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [merchant.id, name, type || "Meal", price, dietary_restrictions || null, available_quantity, best_before_date || null]
    );
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/merchant/items/:id
app.delete("/api/merchant/items/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM items WHERE id = $1", [req.params.id]);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/merchant/analytics
app.get("/api/merchant/analytics", async (req, res) => {
  try {
    const { rows: [merchant] } = await pool.query("SELECT id FROM merchants LIMIT 1");
    if (!merchant) return res.json({ total_orders: 0, total_revenue: 0, items_sold: 0, food_saved_kg: 0 });

    const { rows: [stats] } = await pool.query(`
      SELECT
        COUNT(DISTINCT o.id) AS total_orders,
        COALESCE(SUM(o.total), 0) AS total_revenue,
        COALESCE(SUM(oi.quantity), 0) AS items_sold
      FROM orders o
      JOIN order_items oi ON oi.order_id = o.id
      JOIN items i ON i.id = oi.item_id
      WHERE i.merchant_id = $1
    `, [merchant.id]);

    res.json({
      total_orders: parseInt(stats.total_orders),
      total_revenue: parseFloat(stats.total_revenue),
      items_sold: parseInt(stats.items_sold),
      food_saved_kg: parseFloat(stats.items_sold) * 0.5, // ~0.5kg per item saved
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client/dist/index.html"));
});

const PORT = process.env.PORT || 3000;
migrate().then(() => {
  app.listen(PORT, () => console.log(`ReddaMaten server running on port ${PORT}`));
});
