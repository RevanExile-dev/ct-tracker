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
 * disambiguato tramite la colonna "Set" della tabella (se presente) - mai un
 * "prendo il primo" silenzioso, coerente con la scelta dell'utente per
 * l'import ("auto-match + report finale", non un'anteprima riga per riga: un
 * match incerto NON scrive nulla e finisce nel report da correggere a mano).
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
  | { ok: false; reason: "ambiguous"; candidates: string[] }
> {
  const candidates = await findBlueprintMatches(row.name);
  if (candidates.length === 0) return { ok: false, reason: "unmatched" };

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
    if (narrowed.length > 1) {
      return {
        ok: false, reason: "ambiguous",
        candidates: narrowed.map((c) => `${c.name} (${c.expansionName ?? "espansione sconosciuta"})`),
      };
    }
    // narrowed.length === 0: nessuno dei candidati per nome ha un'espansione
    // compatibile con il Set dichiarato nella riga - anche con un solo
    // candidato per nome, NON e' un match sicuro (e' proprio il caso del
    // commento sopra), quindi cade nel ramo ambiguo qui sotto elencando
    // comunque il/i candidato/i trovato/i per nome, cosi' il report mostra
    // perche' non e' bastato.
  } else if (candidates.length === 1) {
    const only = candidates[0];
    return { ok: true, id: only.id, name: only.name, expansionName: only.expansionName };
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
    // costTotalCents va OMESSO (non passato come null) quando la riga non ha
    // un prezzo leggibile: su un lotto gia' esistente, altrimenti un
    // ri-import con una cella prezzo mal formattata cancellerebbe
    // silenziosamente un costo gia' registrato in precedenza - stesso
    // principio "solo i campi presenti" gia' applicato ad acquiredAt qui
    // sotto (vedi upsertPurchaseLot in web/lib/account.server.ts).
    const { created } = await upsertPurchaseLot(userId, match.id, {
      ...(row.priceCents !== null ? { costTotalCents: row.priceCents } : {}),
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
