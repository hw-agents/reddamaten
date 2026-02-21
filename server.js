const express = require("express");
const { Pool } = require("pg");
const redis = require("redis");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(cors({ origin: true, credentials: true }));

const JWT_SECRET = process.env.JWT_SECRET || "reddamaten-dev-secret-change-in-production";
const JWT_EXPIRES_IN = "15m";
const REFRESH_TOKEN_DAYS = 7;

// Redis client (non-blocking)
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

// ─── MIGRATIONS ────────────────────────────────────────────────────────────────
async function migrate() {
  const client = await pool.connect();
  try {
    // Enable extensions
    await client.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto";`);
    await client.query(`CREATE EXTENSION IF NOT EXISTS "postgis";`).catch(() =>
      console.warn("PostGIS not available — geospatial features disabled")
    );

    // users table (full schema)
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255),
        role VARCHAR(20) NOT NULL DEFAULT 'consumer',
        preferred_language VARCHAR(10) DEFAULT 'sv',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Ensure password_hash column exists (for existing tables)
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'consumer';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
    `).catch(() => {});

    // refresh_tokens
    await client.query(`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        token_hash VARCHAR(255) NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        revoked_at TIMESTAMP
      );
    `);

    // merchants table
    await client.query(`
      CREATE TABLE IF NOT EXISTS merchants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(20),
        address TEXT,
        location VARCHAR(255) NOT NULL DEFAULT 'Stockholm',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // listings table (renamed from items, but keep items for compat)
    await client.query(`
      CREATE TABLE IF NOT EXISTS listings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        merchant_id UUID REFERENCES merchants(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        item_type VARCHAR(50) NOT NULL DEFAULT 'meal',
        food_category VARCHAR(50) NOT NULL DEFAULT 'prepared_meal',
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        original_price DECIMAL(10,2),
        status VARCHAR(20) NOT NULL DEFAULT 'available',
        pickup_time_window VARCHAR(50),
        inventory_count INTEGER NOT NULL DEFAULT 1,
        dietary_restrictions VARCHAR(255),
        is_surprise_bag BOOLEAN DEFAULT false,
        item_weight_kg DECIMAL(4,2) DEFAULT 0.5,
        co2_factor DECIMAL(6,2) DEFAULT 2.5,
        best_before_date DATE,
        use_by_date DATE,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Keep legacy items table for compat
    await client.query(`
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
    `);

    // orders
    await client.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        total DECIMAL(10,2) NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        payment_method VARCHAR(20),
        payment_provider VARCHAR(20) DEFAULT 'stripe',
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Ensure payment_provider column exists
    await client.query(`ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_provider VARCHAR(20) DEFAULT 'stripe';`).catch(() => {});

    // order_items
    await client.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
        item_id UUID REFERENCES items(id),
        listing_id UUID REFERENCES listings(id),
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_price DECIMAL(10,2),
        price DECIMAL NOT NULL DEFAULT 0
      );
    `);

    // ratings
    await client.query(`
      CREATE TABLE IF NOT EXISTS ratings (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        merchant_id UUID REFERENCES merchants(id),
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // favorites
    await client.query(`
      CREATE TABLE IF NOT EXISTS favorites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id),
        merchant_id UUID REFERENCES merchants(id),
        UNIQUE(user_id, merchant_id)
      );
    `);

    // Indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_merchants_user_id ON merchants(user_id);
      CREATE INDEX IF NOT EXISTS idx_items_merchant_id ON items(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_listings_merchant_id ON listings(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
      CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
      CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
      CREATE INDEX IF NOT EXISTS idx_ratings_merchant_id ON ratings(merchant_id);
      CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
    `);

    // Seed demo data if no merchants exist
    const { rows } = await pool.query("SELECT COUNT(*) FROM merchants");
    if (parseInt(rows[0].count) === 0) {
      const m = await pool.query(
        "INSERT INTO merchants (name, location, email, phone) VALUES ($1, $2, $3, $4) RETURNING id",
        ["Demo Bageri AB", "Södermalm, Stockholm", "demo@bageri.se", "+46701234567"]
      );
      const mid = m.rows[0].id;
      await pool.query(
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

// ─── AUTH HELPERS ──────────────────────────────────────────────────────────────
function generateAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

async function createRefreshToken(userId) {
  const raw = crypto.randomBytes(64).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    "INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)",
    [userId, hash, expiresAt]
  );
  return raw;
}

// Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "No token provided" });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Simple in-memory failed login tracker (non-critical, resets on restart)
const loginAttempts = new Map();
function checkRateLimit(ip) {
  const now = Date.now();
  const window = 15 * 60 * 1000;
  const entry = loginAttempts.get(ip) || { count: 0, resetAt: now + window };
  if (now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + window });
    return false;
  }
  if (entry.count >= 5) return true;
  entry.count++;
  loginAttempts.set(ip, entry);
  return false;
}
function resetLoginAttempts(ip) {
  loginAttempts.delete(ip);
}

// ─── HEALTH ENDPOINTS ──────────────────────────────────────────────────────────
const startTime = Date.now();
app.get("/health", (req, res) => res.json({
  status: "ok",
  commit: process.env.SOURCE_COMMIT || "unknown",
  uptime: Math.floor((Date.now() - startTime) / 1000),
  timestamp: new Date()
}));

app.get("/api/health", async (req, res) => {
  const checks = { db: "unknown", redis: "unknown" };
  try { await pool.query("SELECT 1"); checks.db = "ok"; } catch { checks.db = "error"; }
  try {
    if (redisClient.isReady) { await redisClient.ping(); checks.redis = "ok"; }
    else checks.redis = "unavailable";
  } catch { checks.redis = "error"; }
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

// ─── AUTH ENDPOINTS ────────────────────────────────────────────────────────────
// POST /api/auth/register
app.post("/api/auth/register", async (req, res) => {
  const { email, name, password, role = "consumer", phone } = req.body;
  if (!email || !name || !password)
    return res.status(400).json({ error: "email, name, and password are required" });
  if (password.length < 8)
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  if (!["consumer", "merchant"].includes(role))
    return res.status(400).json({ error: "Role must be consumer or merchant" });

  try {
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0)
      return res.status(409).json({ error: "Account already exists" });

    const password_hash = await bcrypt.hash(password, 12);
    const { rows: [user] } = await pool.query(
      "INSERT INTO users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role, preferred_language, created_at",
      [email.toLowerCase().trim(), name.trim(), password_hash, role]
    );

    // If merchant role, create merchant profile
    if (role === "merchant") {
      await pool.query(
        "INSERT INTO merchants (user_id, name, email, phone, location) VALUES ($1, $2, $3, $4, $5)",
        [user.id, name.trim(), email.toLowerCase().trim(), phone || null, "Stockholm"]
      );
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = await createRefreshToken(user.id);
    res.status(201).json({ user, access_token: accessToken, refresh_token: refreshToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
  const ip = req.ip || "unknown";
  if (checkRateLimit(ip))
    return res.status(429).json({ error: "Too many failed attempts. Try again later." });

  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "email and password are required" });

  try {
    const { rows } = await pool.query(
      "SELECT id, email, name, password_hash, role, preferred_language FROM users WHERE email = $1",
      [email.toLowerCase().trim()]
    );
    const user = rows[0];
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    resetLoginAttempts(ip);
    const { password_hash: _, ...safeUser } = user;
    const accessToken = generateAccessToken(safeUser);
    const refreshToken = await createRefreshToken(user.id);
    res.json({ user: safeUser, access_token: accessToken, refresh_token: refreshToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/refresh
app.post("/api/auth/refresh", async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ error: "refresh_token required" });

  const hash = crypto.createHash("sha256").update(refresh_token).digest("hex");
  try {
    const { rows } = await pool.query(
      `SELECT rt.*, u.id as uid, u.email, u.name, u.role, u.preferred_language
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > NOW()`,
      [hash]
    );
    if (!rows[0]) return res.status(401).json({ error: "Invalid or expired refresh token" });

    const row = rows[0];
    // Rotate: revoke old, issue new
    await pool.query("UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1", [row.id]);
    const user = { id: row.uid, email: row.email, name: row.name, role: row.role, preferred_language: row.preferred_language };
    const accessToken = generateAccessToken(user);
    const newRefreshToken = await createRefreshToken(user.id);
    res.json({ access_token: accessToken, refresh_token: newRefreshToken });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout
app.post("/api/auth/logout", async (req, res) => {
  const { refresh_token } = req.body;
  if (refresh_token) {
    const hash = crypto.createHash("sha256").update(refresh_token).digest("hex");
    await pool.query("UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1", [hash]).catch(() => {});
  }
  res.json({ message: "Logged out" });
});

// GET /api/auth/me
app.get("/api/auth/me", authenticateToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, email, name, role, preferred_language, created_at FROM users WHERE id = $1",
      [req.user.sub]
    );
    if (!rows[0]) return res.status(404).json({ error: "User not found" });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/password
app.put("/api/auth/password", authenticateToken, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password)
    return res.status(400).json({ error: "current_password and new_password required" });
  if (new_password.length < 8)
    return res.status(400).json({ error: "Password must be at least 8 characters" });

  try {
    const { rows } = await pool.query("SELECT password_hash FROM users WHERE id = $1", [req.user.sub]);
    if (!rows[0]) return res.status(404).json({ error: "User not found" });
    const valid = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });
    const hash = await bcrypt.hash(new_password, 12);
    await pool.query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [hash, req.user.sub]);
    res.json({ message: "Password updated" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ITEMS / LISTINGS API ──────────────────────────────────────────────────────
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

app.post("/api/orders", async (req, res) => {
  const { item_id, quantity = 1 } = req.body;
  if (!item_id) return res.status(400).json({ error: "item_id required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [item] } = await client.query("SELECT * FROM items WHERE id = $1 FOR UPDATE", [item_id]);
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
    await client.query("UPDATE items SET available_quantity = available_quantity - $1 WHERE id = $2", [quantity, item_id]);
    await client.query("COMMIT");
    res.json({ order_id: order.id, message: "Reserved" });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.get("/api/merchant/items", async (req, res) => {
  try {
    const { rows: [merchant] } = await pool.query("SELECT id FROM merchants LIMIT 1");
    if (!merchant) return res.json([]);
    const { rows } = await pool.query("SELECT * FROM items WHERE merchant_id = $1 ORDER BY created_at DESC", [merchant.id]);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/merchant/items", async (req, res) => {
  const { name, type, price, dietary_restrictions, available_quantity, best_before_date } = req.body;
  if (!name || !price || !available_quantity)
    return res.status(400).json({ error: "name, price, and available_quantity are required" });
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

app.delete("/api/merchant/items/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM items WHERE id = $1", [req.params.id]);
    res.json({ message: "Deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
      food_saved_kg: parseFloat(stats.items_sold) * 0.5,
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
