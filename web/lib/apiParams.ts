import type { CardsFilterOpts } from "./types";

// Parsing condiviso dei filtri catalogo dalla query string, usato da
// /api/cards, /api/cards/count e /api/cards/summary - le stesse tre API
// che in web/lib/db.ts condividono buildCardsFilter() lato client.
export function parseCardsFilterOpts(sp: URLSearchParams): CardsFilterOpts {
  return {
    search: sp.get("search") ?? undefined,
    expansionCode: sp.get("expansionCode") ?? undefined,
    rarities: sp.getAll("rarities"),
    languages: sp.getAll("languages"),
    conditions: sp.getAll("conditions"),
    onlyZero: sp.get("onlyZero") === "1",
    // "idsProvided" (non sp.has("ids")): un array ids VUOTO lato client non
    // produce alcun parametro "ids" in query string (niente da appendere),
    // quindi senza questo flag esplicito il server non potrebbe distinguere
    // "nessun filtro ids" (home, tutto il catalogo) da "filtro ids
    // esplicitamente vuoto" (binder/wishlist senza ancora nessuna carta:
    // nessuna riga deve corrispondere) - vedi cardsFilterParams in
    // web/lib/db.ts.
    ids: sp.get("idsProvided") === "1" ? sp.getAll("ids").map(Number) : undefined,
  };
}
