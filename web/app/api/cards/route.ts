import { NextRequest, NextResponse } from "next/server";
import { fetchCards } from "@/lib/db.server";
import { parseCardsFilterOpts } from "@/lib/apiParams";
import type { SortOption } from "@/lib/types";

// Tetto alle righe per risposta: senza, "?limit=100000" (o nessun limit) fa
// leggere e serializzare l'intero catalogo (~29mila carte, ~20 MB) a ogni
// variante di query, e "?limit=-5" finiva in un 500. Le richieste per id
// (binder, wishlist) restano libere: sono gia' limitate dagli id passati.
const MAX_CARDS_LIMIT = 1000;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const opts = parseCardsFilterOpts(sp);
  const sortBy = (sp.get("sortBy") as SortOption | null) ?? undefined;
  const limitParam = sp.get("limit");
  const requested = limitParam ? Math.floor(Number(limitParam)) : NaN;
  const limit = Number.isFinite(requested) && requested >= 1
    ? Math.min(requested, MAX_CARDS_LIMIT)
    : opts.ids ? undefined : MAX_CARDS_LIMIT;

  const rows = await fetchCards({ ...opts, sortBy, limit });
  return NextResponse.json(rows);
}
