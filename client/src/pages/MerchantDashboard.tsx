import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface Item {
  id: string;
  name: string;
  price: number;
  type: string;
  dietary_restrictions: string;
  available_quantity: number;
  best_before_date: string;
}

interface Analytics {
  total_orders: number;
  total_revenue: number;
  items_sold: number;
  food_saved_kg: number;
}

const TEMPLATES = [
  { name: "Surprise Bag", type: "Surprise Bag", price: 49, dietary_restrictions: "Mixed" },
  { name: "Lunch Leftover", type: "Meal", price: 35, dietary_restrictions: "" },
  { name: "Day-old Bread", type: "Bakery", price: 20, dietary_restrictions: "Vegetarian" },
  { name: "Mixed Groceries", type: "Grocery", price: 55, dietary_restrictions: "" },
];

const emptyForm = { name: "", type: "Meal", price: "", dietary_restrictions: "", available_quantity: "", best_before_date: "" };

export default function MerchantDashboard() {
  const [items, setItems] = useState<Item[]>([]);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"listings" | "analytics">("listings");

  useEffect(() => {
    fetchItems();
    fetchAnalytics();
  }, []);

  const fetchItems = () => {
    fetch("/api/merchant/items")
      .then((r) => r.json())
      .then(setItems)
      .catch(() => {});
  };

  const fetchAnalytics = () => {
    fetch("/api/merchant/analytics")
      .then((r) => r.json())
      .then(setAnalytics)
      .catch(() => {});
  };

  const applyTemplate = (t: typeof TEMPLATES[0]) => {
    setForm((f) => ({ ...f, name: t.name, type: t.type, price: String(t.price), dietary_restrictions: t.dietary_restrictions }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/merchant/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, price: parseFloat(form.price), available_quantity: parseInt(form.available_quantity) }),
      });
      if (res.ok) {
        setMessage("Item listed successfully!");
        setForm({ ...emptyForm });
        fetchItems();
        fetchAnalytics();
      } else {
        const data = await res.json();
        setMessage(data.error || "Failed to save item.");
      }
    } catch {
      setMessage("Network error.");
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(""), 4000);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/merchant/items/${id}`, { method: "DELETE" });
    fetchItems();
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary text-primary-foreground py-4 px-6 shadow">
        <h1 className="text-2xl font-bold">ReddaMaten — Merchant Dashboard</h1>
        <p className="text-sm opacity-90">Manage your surplus food listings</p>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {message && (
          <div className="mb-4 p-3 rounded-md bg-primary/10 text-primary font-medium">{message}</div>
        )}

        <div className="flex gap-3 mb-6">
          <button
            onClick={() => setActiveTab("listings")}
            className={`px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === "listings" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
          >
            Listings
          </button>
          <button
            onClick={() => setActiveTab("analytics")}
            className={`px-4 py-2 rounded-md font-medium text-sm transition-colors ${activeTab === "analytics" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
          >
            Analytics
          </button>
        </div>

        {activeTab === "listings" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Add New Listing</CardTitle>
                <CardDescription>Use a template or fill in manually</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2 mb-4">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.name}
                      onClick={() => applyTemplate(t)}
                      className="px-3 py-1 text-xs rounded-full border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                    >
                      {t.name}
                    </button>
                  ))}
                </div>
                <form onSubmit={handleSubmit} className="space-y-3">
                  <input
                    required
                    placeholder="Item name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
                  />
                  <select
                    value={form.type}
                    onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
                  >
                    <option>Meal</option>
                    <option>Grocery</option>
                    <option>Bakery</option>
                    <option>Surprise Bag</option>
                  </select>
                  <input
                    required
                    type="number"
                    placeholder="Price (kr)"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
                  />
                  <input
                    placeholder="Dietary info (e.g. Vegan, Gluten-free)"
                    value={form.dietary_restrictions}
                    onChange={(e) => setForm((f) => ({ ...f, dietary_restrictions: e.target.value }))}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
                  />
                  <input
                    required
                    type="number"
                    placeholder="Quantity available"
                    value={form.available_quantity}
                    onChange={(e) => setForm((f) => ({ ...f, available_quantity: e.target.value }))}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
                  />
                  <input
                    type="datetime-local"
                    value={form.best_before_date}
                    onChange={(e) => setForm((f) => ({ ...f, best_before_date: e.target.value }))}
                    className="w-full px-3 py-2 border border-input rounded-md text-sm bg-background"
                  />
                  <Button type="submit" className="w-full" disabled={saving}>
                    {saving ? "Saving..." : "List Item"}
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Current Listings ({items.length})</h2>
              {items.length === 0 && (
                <p className="text-muted-foreground text-sm">No items listed yet.</p>
              )}
              {items.map((item) => (
                <Card key={item.id}>
                  <CardContent className="pt-4 flex justify-between items-start">
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <div className="flex gap-2 mt-1">
                        <Badge variant="secondary">{item.type}</Badge>
                        <span className="text-sm text-muted-foreground">{Number(item.price).toFixed(2)} kr</span>
                        <span className="text-sm text-muted-foreground">{item.available_quantity} left</span>
                      </div>
                      {item.dietary_restrictions && (
                        <p className="text-xs text-muted-foreground mt-1">{item.dietary_restrictions}</p>
                      )}
                    </div>
                    <Button variant="destructive" size="sm" onClick={() => handleDelete(item.id)}>
                      Remove
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {activeTab === "analytics" && analytics && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Total Orders", value: analytics.total_orders },
              { label: "Revenue (kr)", value: Number(analytics.total_revenue || 0).toFixed(2) },
              { label: "Items Sold", value: analytics.items_sold },
              { label: "Food Saved (kg)", value: Number(analytics.food_saved_kg || 0).toFixed(1) },
            ].map((stat) => (
              <Card key={stat.label}>
                <CardHeader className="pb-2">
                  <CardDescription>{stat.label}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-bold text-primary">{stat.value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
