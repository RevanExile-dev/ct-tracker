import "server-only";
import { findBlueprintMatches } from "./db.server";
import { upsertBinderEntry, upsertPurchaseLot } from "./account.server";
import type { ParsedImportRow } from "./lotImport";

// Applica al DB le righe gia' parsate da web/lib/lotImport.ts (puro,
// senza DB) - separato in un modulo a parte perche' qui serve sia il
// catalogo (matching nome->carta) sia binder/lotti dell'utente, entrambi
// solo lato server. Usato da POST /api/account/lots/import.

export type ImportRowOutcome =
  | { status: "imported"; rowNumber: number; name: string; matchedName: string; matchedExpansion: string | null; created: boolean }
  | { status: "unmatched"; rowNumber: number; name: string }
  | { status: "ambiguous"; rowNumber: number; name: string; candidates: string[] };

/** Un candidato per riga: esatto quando c'e' un solo risultato dal nome, o
 * disambiguato tramite la colonna "Set" della tabella (se presente) quando
 * il nome da solo torna piu' risultati - mai un "prendo il primo" silenzioso,
 * coerente con la scelta dell'utente per l'import ("auto-match + report
 * finale", non un'anteprima riga per riga: un match incerto NON scrive nulla
 * e finisce nel report da correggere a mano). */
async function matchRow(row: ParsedImportRow): Promise<
  | { ok: true; id: number; name: string; expansionName: string | null }
  | { ok: false; reason: "unmatched" }
  | { ok: false; reason: "ambiguous"; candidates: string[] }
> {
  const candidates = await findBlueprintMatches(row.name);
  if (candidates.length === 0) return { ok: false, reason: "unmatched" };
  if (candidates.length === 1) {
    const only = candidates[0];
    return { ok: true, id: only.id, name: only.name, expansionName: only.expansionName };
  }
  if (row.set) {
    const setLower = row.set.toLowerCase();
    const narrowed = candidates.filter((c) => {
      const expLower = (c.expansionName ?? "").toLowerCase();
      return expLower.includes(setLower) || setLower.includes(expLower);
    });
    if (narrowed.length === 1) {
      const only = narrowed[0];
      return { ok: true, id: only.id, name: only.name, expansionName: only.expansionName };
    }
  }
  return {
    ok: false,
    reason: "ambiguous",
    candidates: candidates.map((c) => `${c.name} (${c.expansionName ?? "espansione sconosciuta"})`),
  };
}

export async function applyLotImport(userId: string, rows: ParsedImportRow[]): Promise<ImportRowOutcome[]> {
  const outcomes: ImportRowOutcome[] = [];
  for (const row of rows) {
    const match = await matchRow(row);
    if (!match.ok) {
      outcomes.push(
        match.reason === "unmatched"
          ? { status: "unmatched", rowNumber: row.rowNumber, name: row.name }
          : { status: "ambiguous", rowNumber: row.rowNumber, name: row.name, candidates: match.candidates }
      );
      continue;
    }
    // Assicura che la carta sia nel binder (upsertBinderEntry non rimuove
    // ne' sovrascrive mai campi gia' presenti, vedi web/lib/account.server.ts) -
    // una carta comprata va segnata come posseduta, non solo registrata come
    // lotto isolato.
    await upsertBinderEntry(userId, match.id, {});
    const { created } = await upsertPurchaseLot(userId, match.id, {
      costTotalCents: row.priceCents,
      acquiredAt: row.acquiredAt ?? undefined,
    });
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
