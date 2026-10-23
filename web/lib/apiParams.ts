import type { CardsFilterOpts } from "./types";
import { isValidBlueprintId } from "./accountLimits";

// Parsing condiviso dei filtri catalogo dalla query string, usato da
// /api/cards, /api/cards/count e /api/cards/summary - le stesse tre API
// che in web/lib/db.ts condividono buildCardsFilter() lato client.
function parseCents(raw: string | null): number | undefined {
  if (raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 100_000_000 ? Math.floor(n) : undefined;
}

/** Una pagina positiva intera, con OFFSET rappresentabile senza perdere
 * precisione. Parametri malformati tornano alla prima pagina: non arrivano
 * a Postgres come NaN, Infinity o un OFFSET decimale. */
export function parsePageNumber(raw: string | null, pageSize: number): number {
  const page = Number(raw);
  return Number.isSafeInteger(page) && page >= 1 && Number.isSafeInteger((page - 1) * pageSize)
    ? page
    : 1;
}

export function parseCardsFilterOpts(sp: URLSearchParams): CardsFilterOpts {
  return {
    search: sp.get("search") ?? undefined,
    exactName: sp.get("exactName") === "1",
    expansionCode: sp.get("expansionCode") ?? undefined,
    rarities: sp.getAll("rarities"),
    artists: sp.getAll("artists"),
    languages: sp.getAll("languages"),
    conditions: sp.getAll("conditions"),
    onlyZero: sp.get("onlyZero") === "1",
    onlyPremium: sp.get("onlyPremium") === "1",
    minPriceCents: parseCents(sp.get("minPriceCents")),
    maxPriceCents: parseCents(sp.get("maxPriceCents")),
    // "idsProvided" (non sp.has("ids")): un array ids VUOTO lato client non
    // produce alcun parametro "ids" in query string (niente da appendere),
    // quindi senza questo flag esplicito il server non potrebbe distinguere
    // "nessun filtro ids" (home, tutto il catalogo) da "filtro ids
    // esplicitamente vuoto" (binder/wishlist senza ancora nessuna carta:
    // nessuna riga deve corrispondere) - vedi cardsFilterParams in
    // web/lib/db.ts.
    // Un id non valido non deve diventare un errore SQL. Anche se non ne
    // resta nessuno, [] mantiene il filtro esplicito (mai tutto il catalogo).
    ids: sp.get("idsProvided") === "1" ? sp.getAll("ids").map(Number).filter(isValidBlueprintId) : undefined,
  };
}
