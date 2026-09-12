import { NextRequest, NextResponse } from "next/server";
import { fetchOwnedLanguagePrices } from "@/lib/db.server";

// Un binder realistico resta ben sotto questo tetto (poche centinaia di
// carte al massimo) - il limite esiste solo per non permettere una VALUES
// list arbitrariamente grande su un endpoint pubblico senza login.
const MAX_ENTRIES = 500;

/** Dato pubblico di catalogo (stesso livello di fiducia di GET /api/cards),
 * nessuna autenticazione richiesta: il binder di un utente resta privato
 * (gli ID/lingue restano lato client, mai salvati qui), solo il prezzo
 * risultante viene interrogato. POST invece di GET perche' un binder puo'
 * avere piu' carte di quante ne stiano comodamente in una query string. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body)) {
    return NextResponse.json({ error: "Corpo della richiesta non valido: atteso un array" }, { status: 400 });
  }
  if (body.length > MAX_ENTRIES) {
    return NextResponse.json({ error: `Troppe carte in una sola richiesta (max ${MAX_ENTRIES})` }, { status: 400 });
  }
  const entries: { blueprintId: number; language: string }[] = [];
  for (const item of body) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const blueprintId = Number(record.id);
    const language = record.language;
    if (!Number.isFinite(blueprintId) || typeof language !== "string" || !language) continue;
    entries.push({ blueprintId, language });
  }
  return NextResponse.json(await fetchOwnedLanguagePrices(entries));
}
