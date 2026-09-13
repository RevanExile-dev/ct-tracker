import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Best-effort, non distribuito: ogni istanza serverless di Vercel ha la sua
// mappa in memoria, quindi il limite reale e' "N richieste per istanza" non
// un rate limiting globale (servirebbe Redis/Upstash per quello). Resta
// comunque un primo argine concreto, a costo zero di infrastruttura, contro
// scraping massivo del catalogo ed email bombing sul login - il traffico
// di un singolo IP che abusa converge quasi sempre sulla stessa istanza per
// una finestra di pochi secondi/minuti.
const hits = new Map<string, number[]>();

function isAllowed(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  return true;
}

function clientIp(request: NextRequest): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

type RateLimitRule = { id: string; matches: (pathname: string) => boolean; limit: number; windowMs: number };

const RATE_LIMIT_RULES: RateLimitRule[] = [
  // Login via magic link (Resend): ogni richiesta costa una vera email e
  // consuma la quota giornaliera gratuita (100/giorno) - limite stretto per
  // IP per evitare sia l'esaurimento della quota sia l'email bombing verso
  // l'indirizzo di un terzo.
  { id: "auth-signin", matches: (p) => p.startsWith("/api/auth/signin"), limit: 5, windowMs: 60_000 },
  // Resto delle API pubbliche (catalogo/prezzi/binder/wishlist/alert...):
  // limite piu' permissivo, pensato per fermare scraping massivo o un bug
  // client che martella un endpoint, non l'uso normale della UI.
  { id: "api-general", matches: (p) => p.startsWith("/api/"), limit: 60, windowMs: 10_000 },
];

export function proxy(request: NextRequest) {
  const rule = RATE_LIMIT_RULES.find((r) => r.matches(request.nextUrl.pathname));
  if (!rule) return NextResponse.next();

  const key = `${rule.id}:${clientIp(request)}`;
  if (!isAllowed(key, rule.limit, rule.windowMs)) {
    return NextResponse.json(
      { error: "Troppe richieste, riprova tra poco." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(rule.windowMs / 1000)) } },
    );
  }
  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
