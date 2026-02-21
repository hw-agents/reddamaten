import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
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
  merchant_name: string;
  merchant_location: string;
}

const DIETARY_FILTERS = ["All", "Vegan", "Vegetarian", "Gluten-free", "Halal"];
const TYPE_FILTERS = ["All", "Meal", "Grocery", "Bakery", "Surprise Bag"];

export default function ConsumerApp() {
  const [items, setItems] = useState<Item[]>([]);
  const [dietaryFilter, setDietaryFilter] = useState("All");
  const [typeFilter, setTypeFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [reserving, setReserving] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/items")
      .then((r) => r.json())
      .then((data) => { setItems(data); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const filtered = items.filter((item) => {
    const dietMatch = dietaryFilter === "All" || item.dietary_restrictions?.toLowerCase().includes(dietaryFilter.toLowerCase());
    const typeMatch = typeFilter === "All" || item.type?.toLowerCase() === typeFilter.toLowerCase();
    return dietMatch && typeMatch;
  });

  const handleReserve = async (itemId: string) => {
    setReserving(itemId);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: itemId, quantity: 1 }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessage("Reserved successfully! Pick up at the merchant location.");
        setItems((prev) => prev.map((i) => i.id === itemId ? { ...i, available_quantity: i.available_quantity - 1 } : i));
      } else {
        setMessage(data.error || "Reservation failed. Please try again.");
      }
    } catch {
      setMessage("Network error. Please try again.");
    } finally {
      setReserving(null);
      setTimeout(() => setMessage(""), 4000);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-primary text-primary-foreground py-4 px-6 shadow">
        <h1 className="text-2xl font-bold">ReddaMaten</h1>
        <p className="text-sm opacity-90">Reduce food waste — buy surplus food at great prices</p>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {message && (
          <div className="mb-4 p-3 rounded-md bg-primary/10 text-primary font-medium">{message}</div>
        )}

        <div className="flex flex-wrap gap-3 mb-6">
          <div>
            <p className="text-xs text-muted-foreground mb-1 font-medium">Dietary</p>
            <div className="flex gap-2 flex-wrap">
              {DIETARY_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setDietaryFilter(f)}
                  className={`px-3 py-1 rounded-full text-sm border transition-colors ${dietaryFilter === f ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1 font-medium">Type</p>
            <div className="flex gap-2 flex-wrap">
              {TYPE_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setTypeFilter(f)}
                  className={`px-3 py-1 rounded-full text-sm border transition-colors ${typeFilter === f ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading && <p className="text-muted-foreground">Loading offers...</p>}

        {!loading && filtered.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-lg">No offers available right now.</p>
            <p className="text-sm mt-1">Check back later or adjust your filters.</p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((item) => (
            <Card key={item.id} className="flex flex-col">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg">{item.name}</CardTitle>
                  <Badge variant="secondary">{item.type}</Badge>
                </div>
                <CardDescription>{item.merchant_name} — {item.merchant_location}</CardDescription>
              </CardHeader>
              <CardContent className="flex-1">
                <p className="text-2xl font-bold text-primary">{Number(item.price).toFixed(2)} kr</p>
                {item.dietary_restrictions && (
                  <p className="text-xs text-muted-foreground mt-1">{item.dietary_restrictions}</p>
                )}
                <p className="text-sm text-muted-foreground mt-2">
                  {item.available_quantity} left
                  {item.best_before_date && ` · Best before ${new Date(item.best_before_date).toLocaleDateString("sv-SE")}`}
                </p>
              </CardContent>
              <CardFooter>
                <Button
                  className="w-full"
                  disabled={item.available_quantity === 0 || reserving === item.id}
                  onClick={() => handleReserve(item.id)}
                >
                  {reserving === item.id ? "Reserving..." : item.available_quantity === 0 ? "Sold Out" : "Reserve Now"}
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
