import { useState, useEffect } from "react";
import ConsumerApp from "./pages/ConsumerApp";
import MerchantDashboard from "./pages/MerchantDashboard";
import AuthPage from "./pages/AuthPage";
import { Button } from "@/components/ui/button";
import {
  type User,
  setAccessToken,
  getRefreshToken,
  clearRefreshToken,
  refreshAccessToken,
} from "@/lib/auth";

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [view, setView] = useState<"consumer" | "merchant">("consumer");
  const [authLoading, setAuthLoading] = useState(true);

  // On mount: try to restore session via refresh token
  useEffect(() => {
    const restore = async () => {
      const rt = getRefreshToken();
      if (rt) {
        const ok = await refreshAccessToken();
        if (ok) {
          try {
            const { getAccessToken } = await import("@/lib/auth");
            const token = getAccessToken();
            if (token) {
              const meRes = await fetch("/api/auth/me", {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (meRes.ok) {
                const userData = await meRes.json();
                setUser(userData);
                setView(userData.role === "merchant" ? "merchant" : "consumer");
              }
            }
          } catch {
            // silent
          }
        }
      }
      setAuthLoading(false);
    };
    restore();
  }, []);

  const handleAuth = (userData: User) => {
    setUser(userData);
    setView(userData.role === "merchant" ? "merchant" : "consumer");
  };

  const handleLogout = async () => {
    const { getRefreshToken: getRT } = await import("@/lib/auth");
    const rt = getRT();
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: rt }),
    }).catch(() => {});
    setAccessToken(null);
    clearRefreshToken();
    setUser(null);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Laddar...</p>
      </div>
    );
  }

  if (!user) {
    return <AuthPage onAuth={handleAuth} />;
  }

  return (
    <div>
      <nav className="bg-white border-b border-border px-6 py-2 flex gap-4 items-center text-sm">
        {user.role !== "merchant" && (
          <button
            onClick={() => setView("consumer")}
            className={`font-medium transition-colors ${view === "consumer" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            Utforska mat
          </button>
        )}
        {user.role === "merchant" && (
          <button
            onClick={() => setView("merchant")}
            className={`font-medium transition-colors ${view === "merchant" ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            Butikspanel
          </button>
        )}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-muted-foreground hidden sm:block">
            {user.name} <span className="text-xs">({user.role})</span>
          </span>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            Logga ut
          </Button>
        </div>
      </nav>
      {view === "consumer" ? <ConsumerApp /> : <MerchantDashboard />}
    </div>
  );
}
