import { NextRequest, NextResponse } from "next/server";
import { fetchCardsTrend } from "@/lib/db.server";

export async function GET(req: NextRequest) {
  // .flatMap(split su virgola): il client di questo endpoint (fetchCardsTrend
  // in web/lib/db.ts, via apiFetch) manda sempre parametri ripetuti
  // (?ids=1&ids=2), mai una lista comma-separated - ma un client futuro o
  // una chiamata manuale con ?ids=1,2,3 non deve silenziosamente restituire
  // un risultato vuoto invece di un errore o dei dati (rilievo review
  // Gemini su PR #46).
  const ids = req.nextUrl.searchParams
    .getAll("ids")
    .flatMap((v) => v.split(","))
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  const daysParam = Number(req.nextUrl.searchParams.get("days"));
  // Math.trunc: un days decimale arriverebbe a Postgres come "1.5"::int, che
  // FALLISCE con un errore SQL (invalid input syntax for type integer) -
  // non un troncamento silenzioso come si potrebbe pensare.
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(Math.trunc(daysParam), 365) : 30;
  return NextResponse.json(await fetchCardsTrend(ids, days));
}
