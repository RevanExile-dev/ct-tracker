import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { ipAddress } from "@vercel/functions";
import { isRateLimited } from "@/lib/rateLimit";

type RateLimitRule = { id: string; matches: (req: NextRequest) => boolean; limit: number; windowMs: number };

const RATE_LIMIT_RULES: RateLimitRule[] = [
  // Invio diretto a /api/auth/signin/resend (bypassando la UI): la Server
  // Action reale di /login (vedi lib/rateLimit.ts) e' gia' limitata per
  // conto suo, ma questa route resta comunque raggiungibile direttamente -
  // solo POST, altrimenti un GET di navigazione verso /api/auth/signin
  // consumerebbe il limite senza mai inviare un'email.
  {
    id: "auth-signin",
    matches: (req) => req.method === "POST" && req.nextUrl.pathname.startsWith("/api/auth/signin"),
    limit: 5,
    windowMs: 60_000,
  },
  // Resto delle API pubbliche (catalogo/prezzi/binder/wishlist/alert...):
  // limite alto apposta - misurato con Playwright che una singola apertura
  // della home fa gia' ~10 fetch quasi simultanei (expansions/rarities/
  // languages/conditions/meta/catalog-stats/cards/cards-count/session x2),
  // e un limite di 60/10s (il valore iniziale di questa PR) bloccava con
  // 429 reali gia' dopo poche ricariche di pagina/tab aperte in parallelo
  // sullo stesso IP - verificato che causava proprio questo il fallimento
  // del test CI "UI smoke", non un problema del test. 400/10s lascia
  // ampio margine all'uso normale (anche piu' utenti dietro lo stesso NAT)
  // mentre rallenta comunque uno scraping sostenuto dell'intero catalogo
  // (29mila carte) a poche decine di minuti invece che pochi secondi.
  { id: "api-general", matches: (req) => req.nextUrl.pathname.startsWith("/api/"), limit: 400, windowMs: 10_000 },
];

export function proxy(request: NextRequest) {
  const rule = RATE_LIMIT_RULES.find((r) => r.matches(request));
  if (!rule) return NextResponse.next();

  // x-real-ip e' calcolato dal proxy di Vercel stesso (non dal client): a
  // differenza di x-forwarded-for, il cui primo valore puo' essere
  // impostato liberamente dal chiamante, questo non e' falsificabile.
  // Verificato leggendo l'implementazione di ipAddress() in
  // @vercel/functions (legge solo l'header x-real-ip).
  const ip = ipAddress(request) ?? "unknown";
  const key = `${rule.id}:${ip}`;
  if (isRateLimited(key, rule.limit, rule.windowMs)) {
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
