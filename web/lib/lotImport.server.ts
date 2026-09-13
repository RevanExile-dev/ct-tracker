import "server-only";
import { type BlueprintMatchCandidate, findBlueprintById, findBlueprintMatches } from "./db.server";
import { getExistingPurchaseInfo, upsertBinderEntry, upsertPurchaseLot } from "./account.server";
import { narrowByDeclaredType, type ParsedImportRow } from "./lotImport";

// Applica al DB le righe gia' parsate da web/lib/lotImport.ts (puro,
// senza DB) - separato in un modulo a parte perche' qui serve sia il
// catalogo (matching nome->carta) sia binder/lotti dell'utente, entrambi
// solo lato server. Usato da POST /api/account/lots/import e, per la
// risoluzione manuale di una singola riga rimasta ambigua/non trovata, da
// POST /api/account/lots/import/resolve.

export type ImportCandidate = { id: number; name: string; expansionName: string | null; rarity: string | null; imageUrl: string | null };

export type ImportRowOutcome =
  | { status: "imported"; rowNumber: number; name: string; matchedName: string; matchedExpansion: string | null; created: boolean }
  // priceCents/acquiredAt: gli stessi valori gia' estratti dalla riga
  // (web/lib/lotImport.ts) - il chiamante NON riparsa il Markdown per
  // risolvere manualmente una riga: web/components/LotImportPanel.tsx li
  // rimanda cosi' come sono a POST /api/account/lots/import/resolve una
  // volta che l'utente ha scelto la carta giusta.
  | { status: "unmatched"; rowNumber: number; name: string; priceCents: number | null; acquiredAt: string | null }
  // declaredType: il "Tipo"/rarita' dichiarati nella riga cosi' come scritti
  // dall'utente (es. "IR"), non normalizzati - passato SOLO per farlo
  // vedere nella UI di risoluzione manuale accanto ai candidati (che
  // mostrano gia' la propria rarita' reale, vedi ImportCandidate.rarity):
  // se il matching automatico in narrowByType sotto non e' bastato a
  // scendere a un solo candidato, l'utente ha comunque modo di confrontare
  // "quello che ho scritto io" con "quello che il catalogo chiama cosi'"
  // senza dover indovinare.
  | { status: "ambiguous"; rowNumber: number; name: string; priceCents: number | null; acquiredAt: string | null; declaredType: string | null; candidates: ImportCandidate[] }
  // Carta trovata SENZA ambiguita' ma gia' presente nel binder: NON scritta
  // in automatico (richiesta esplicita dell'utente dopo aver notato che un
  // ri-import aggiornava silenziosamente prezzo/data di carte gia'
  // importate) - matchedId e' pronto per essere rimandato cosi' com'e' a
  // POST /api/account/lots/import/resolve se l'utente conferma
  // l'aggiornamento (stesso endpoint usato per le righe ambigue/non
  // trovate, qui con un solo candidato gia' scelto dal matching). Se
  // l'utente non conferma, la riga resta cosi' com'era prima dell'import.
  | {
      status: "confirm_update"; rowNumber: number; name: string; priceCents: number | null; acquiredAt: string | null;
      matchedId: number; matchedName: string; matchedExpansion: string | null;
      existingCostCents: number | null; existingAcquiredAt: string | null;
    };

function toImportCandidate(c: BlueprintMatchCandidate): ImportCandidate {
  return { id: c.id, name: c.name, expansionName: c.expansionName, rarity: c.rarity, imageUrl: c.imageUrl };
}

/** Un candidato per riga: esatto quando c'e' un solo risultato dal nome, o
 * disambiguato tramite la colonna "Set" della tabella (se presente) - mai un
 * "prendo il primo" silenzioso, coerente con la scelta dell'utente per
 * l'import ("auto-match + report finale", non un'anteprima riga per riga: un
 * match incerto NON scrive nulla di suo conto e finisce nel report, con
 * pero' un pulsante per risolverlo a mano - vedi LotImportPanel.tsx).
 *
 * Quando la riga porta una colonna Set, va sempre verificata ANCHE se
 * findBlueprintMatches ha gia' trovato un solo candidato per nome (rilievo
 * review, verificato reale): il catalogo traccia solo un sottoinsieme di
 * espansioni (vedi config/), quindi "un solo candidato per questo nome"
 * puo' benissimo essere la stampa SBAGLIATA di una carta ristampata in piu'
 * set di cui il catalogo ne conosce solo uno - senza questo controllo
 * un'unica carta "Pikachu" tracciata (es. Base Set) verrebbe accettata
 * anche per una riga che dichiara esplicitamente un Set diverso (es. "Crown
 * Zenith"), scrivendo il lotto sulla carta sbagliata. */
async function matchRow(row: ParsedImportRow): Promise<
  | { ok: true; id: number; name: string; expansionName: string | null }
  | { ok: false; reason: "unmatched" }
  | { ok: false; reason: "ambiguous"; candidates: ImportCandidate[] }
> {
  const candidates = await findBlueprintMatches(row.name);
  if (candidates.length === 0) return { ok: false, reason: "unmatched" };

  if (row.set) {
    const setLower = row.set.toLowerCase();
    const narrowed = candidates.filter((c) => {
      const expLower = (c.expansionName ?? "").toLowerCase();
      return expLower.includes(setLower) || setLower.includes(expLower);
    });
    // Un Set DICHIARATO che non trova nessun candidato compatibile resta
    // qui dentro (rilievo review, verificato reale: la versione precedente
    // cadeva fuori da questo blocco quando narrowed.length === 0, finendo
    // nel fallback "nessun Set" sotto - che applica narrowByDeclaredType
    // all'INTERO elenco candidates, ignorando che l'utente aveva
    // esplicitamente scritto un Set che non ha trovato riscontro. Un Tipo
    // che per puro caso narrows a un solo risultato in tutto il catalogo
    // avrebbe cosi' scavalcato un Set sbagliato/typo, scrivendo la carta
    // di un set diverso da quello dichiarato). Con narrowed.length === 0
    // l'unica cosa sicura e' l'ambiguita' sui candidati per nome, mai un
    // altro tentativo di narrowing che dimenticherebbe il Set indicato.
    const byType = narrowByDeclaredType(narrowed, row.type);
    if (byType.length === 1) {
      const only = byType[0];
      return { ok: true, id: only.id, name: only.name, expansionName: only.expansionName };
    }
    // byType e' narrowed stesso se il Tipo non ha aiutato (narrowByDeclaredType
    // non torna mai piu' elementi di quanti gliene sono passati) - se
    // narrowed era vuoto, resta vuoto: mostriamo comunque i candidati per
    // nome (non narrowed) nel report, cosi' l'utente vede perche' il Set
    // dichiarato non e' bastato.
    return { ok: false, reason: "ambiguous", candidates: (narrowed.length > 0 ? byType : candidates).map(toImportCandidate) };
  }

  if (candidates.length === 1) {
    const only = candidates[0];
    return { ok: true, id: only.id, name: only.name, expansionName: only.expansionName };
  }

  // Nessun Set nella riga: un'ultima chance con il Tipo dichiarato prima di
  // arrendersi, stesso principio del ramo con Set.
  const byType = narrowByDeclaredType(candidates, row.type);
  if (byType.length === 1) {
    const only = byType[0];
    return { ok: true, id: only.id, name: only.name, expansionName: only.expansionName };
  }
  return { ok: false, reason: "ambiguous", candidates: byType.map(toImportCandidate) };
}

/** Scrive nel binder+lotti dell'utente un blueprintId gia' certo (o perche'
 * il matching automatico lo ha trovato senza ambiguita', o perche' l'utente
 * lo ha scelto a mano dalla UI di risoluzione) - unico punto che tocca
 * davvero binder_cards/binder_lots per l'import, condiviso tra
 * applyLotImport sotto e POST /api/account/lots/import/resolve, cosi' i due
 * percorsi non possono divergere nella logica di scrittura. */
export async function writeImportedCard(
  userId: string,
  blueprintId: number,
  patch: { costTotalCents: number | null; acquiredAt?: string | null }
): Promise<{ created: boolean }> {
  // Assicura che la carta sia nel binder (upsertBinderEntry non rimuove ne'
  // sovrascrive mai campi gia' presenti, vedi web/lib/account.server.ts) -
  // una carta comprata va segnata come posseduta, non solo registrata come
  // lotto isolato.
  await upsertBinderEntry(userId, blueprintId, {});
  // costTotalCents/acquiredAt vanno OMESSI dal patch (non passati come
  // null/undefined) quando non leggibili dalla riga: su un lotto gia'
  // esistente, altrimenti un ri-import con una cella prezzo/data mal
  // formattata cancellerebbe silenziosamente un valore gia' registrato in
  // precedenza (vedi upsertPurchaseLot in web/lib/account.server.ts).
  const { created } = await upsertPurchaseLot(userId, blueprintId, {
    ...(patch.costTotalCents !== null ? { costTotalCents: patch.costTotalCents } : {}),
    ...(patch.acquiredAt ? { acquiredAt: patch.acquiredAt } : {}),
  });
  return { created };
}

export async function applyLotImport(userId: string, rows: ParsedImportRow[]): Promise<ImportRowOutcome[]> {
  const outcomes: ImportRowOutcome[] = [];
  for (const row of rows) {
    const match = await matchRow(row);
    if (!match.ok) {
      outcomes.push(
        match.reason === "unmatched"
          ? { status: "unmatched", rowNumber: row.rowNumber, name: row.name, priceCents: row.priceCents, acquiredAt: row.acquiredAt }
          : { status: "ambiguous", rowNumber: row.rowNumber, name: row.name, priceCents: row.priceCents, acquiredAt: row.acquiredAt, declaredType: row.type, candidates: match.candidates }
      );
      continue;
    }
    // Carta gia' nel binder: non si scrive nulla senza conferma esplicita
    // (vedi commento su "confirm_update" sopra) - una carta NUOVA per
    // l'utente invece si aggiunge subito, come sempre.
    const existing = await getExistingPurchaseInfo(userId, match.id);
    if (existing.inBinder) {
      outcomes.push({
        status: "confirm_update",
        rowNumber: row.rowNumber, name: row.name, priceCents: row.priceCents, acquiredAt: row.acquiredAt,
        matchedId: match.id, matchedName: match.name, matchedExpansion: match.expansionName,
        existingCostCents: existing.costTotalCents, existingAcquiredAt: existing.acquiredAt,
      });
      continue;
    }
    const { created } = await writeImportedCard(userId, match.id, { costTotalCents: row.priceCents, acquiredAt: row.acquiredAt });
    outcomes.push({
      status: "imported",
      rowNumber: row.rowNumber,
      name: row.name,
      matchedName: match.name,
      matchedExpansion: match.expansionName,
      created,
    });
  }
  return outcomes;
}

export type ResolveImportRowResult =
  | { ok: true; matchedName: string; matchedExpansion: string | null; created: boolean }
  | { ok: false; reason: "not_found" };

/** Risolve manualmente una riga di import rimasta ambigua/non trovata: il
 * client passa il blueprintId scelto dall'utente nella UI (uno dei
 * candidati mostrati, o un risultato di ricerca libera per una riga
 * "unmatched") - verificato per esistenza reale prima di scrivere
 * qualunque cosa, mai fidato cosi' com'e'. */
export async function resolveImportRow(
  userId: string,
  blueprintId: number,
  patch: { costTotalCents: number | null; acquiredAt?: string | null }
): Promise<ResolveImportRowResult> {
  const blueprint = await findBlueprintById(blueprintId);
  if (!blueprint) return { ok: false, reason: "not_found" };
  const { created } = await writeImportedCard(userId, blueprintId, patch);
  return { ok: true, matchedName: blueprint.name, matchedExpansion: blueprint.expansionName, created };
}
