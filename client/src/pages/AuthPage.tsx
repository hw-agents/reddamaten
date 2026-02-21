import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setAccessToken, saveRefreshToken, type User } from "@/lib/auth";

interface AuthPageProps {
  onAuth: (user: User, accessToken: string) => void;
}

type Mode = "login" | "register-consumer" | "register-merchant";

export default function AuthPage({ onAuth }: AuthPageProps) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      let res: Response;
      if (mode === "login") {
        res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
      } else {
        const role = mode === "register-merchant" ? "merchant" : "consumer";
        res = await fetch("/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, name, password, role, phone: phone || undefined }),
        });
      }
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }
      setAccessToken(data.access_token);
      saveRefreshToken(data.refresh_token);
      onAuth(data.user, data.access_token);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const isRegister = mode !== "login";

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-bold text-primary">ReddaMaten</h1>
        <p className="text-muted-foreground text-sm mt-1">Minska matsvinn — köp överskottsmat till bra pris</p>
      </div>

      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>
            {mode === "login" ? "Logga in" : mode === "register-merchant" ? "Registrera butik" : "Skapa konto"}
          </CardTitle>
          <CardDescription>
            {mode === "login"
              ? "Välkommen tillbaka till ReddaMaten"
              : mode === "register-merchant"
              ? "Sätt upp din butik och börja sälja överskottsmat"
              : "Registrera dig och hitta billig mat nära dig"}
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm">{error}</div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">E-post</Label>
              <Input
                id="email"
                type="email"
                placeholder="din@email.se"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {isRegister && (
              <div className="space-y-2">
                <Label htmlFor="name">{mode === "register-merchant" ? "Butiksnamn" : "Namn"}</Label>
                <Input
                  id="name"
                  type="text"
                  placeholder={mode === "register-merchant" ? "Demo Bageri AB" : "Anna Svensson"}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              </div>
            )}

            {mode === "register-merchant" && (
              <div className="space-y-2">
                <Label htmlFor="phone">Telefon (valfritt)</Label>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="+46701234567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="password">Lösenord</Label>
              <Input
                id="password"
                type="password"
                placeholder="Minst 8 tecken"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
              />
            </div>
          </CardContent>

          <CardFooter className="flex flex-col gap-3">
            <Button type="submit" className="w-full" disabled={loading}>
              {loading
                ? "Laddar..."
                : mode === "login"
                ? "Logga in"
                : mode === "register-merchant"
                ? "Skapa butikskonto"
                : "Skapa konto"}
            </Button>

            <div className="flex flex-col gap-1 w-full text-center text-sm">
              {mode !== "login" && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => { setMode("login"); setError(""); }}
                >
                  Har du redan ett konto? <span className="text-primary font-medium">Logga in</span>
                </button>
              )}
              {mode !== "register-consumer" && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => { setMode("register-consumer"); setError(""); }}
                >
                  {mode === "login" ? "Inget konto?" : "Registrera som konsument istället"}{" "}
                  <span className="text-primary font-medium">Skapa konsumentkonto</span>
                </button>
              )}
              {mode !== "register-merchant" && (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => { setMode("register-merchant"); setError(""); }}
                >
                  Är du en butik?{" "}
                  <span className="text-primary font-medium">Registrera butik</span>
                </button>
              )}
            </div>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
