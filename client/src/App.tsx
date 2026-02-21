import { useState } from "react";
import ConsumerApp from "./pages/ConsumerApp";
import MerchantDashboard from "./pages/MerchantDashboard";

export default function App() {
  const [view, setView] = useState<"consumer" | "merchant">("consumer");

  return (
    <div>
      <nav className="bg-white border-b border-border px-6 py-2 flex gap-4 text-sm">
        <button
          onClick={() => setView("consumer")}
          className={`font-medium transition-colors ${view === "consumer" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
        >
          Consumer App
        </button>
        <button
          onClick={() => setView("merchant")}
          className={`font-medium transition-colors ${view === "merchant" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
        >
          Merchant Dashboard
        </button>
      </nav>
      {view === "consumer" ? <ConsumerApp /> : <MerchantDashboard />}
    </div>
  );
}
