// Auth token management — access token stored in memory only
let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function getAuthHeaders(): Record<string, string> {
  if (!accessToken) return {};
  return { Authorization: `Bearer ${accessToken}` };
}

// Refresh token stored in localStorage (not HTTP-only cookie since we don't have HTTPS-only env)
export function saveRefreshToken(token: string) {
  localStorage.setItem("reddamaten_refresh", token);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem("reddamaten_refresh");
}

export function clearRefreshToken() {
  localStorage.removeItem("reddamaten_refresh");
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: "consumer" | "merchant" | "admin";
  preferred_language: string;
}

export async function refreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const res = await fetch("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) { clearRefreshToken(); return false; }
    const data = await res.json();
    setAccessToken(data.access_token);
    saveRefreshToken(data.refresh_token);
    return true;
  } catch {
    return false;
  }
}
