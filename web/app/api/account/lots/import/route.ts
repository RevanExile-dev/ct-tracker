import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseLotImportMarkdown } from "@/lib/lotImport";
import { applyLotImport } from "@/lib/lotImport.server";

// Tetto sulla lunghezza del testo (non tecnico): protegge la CPU della
// route da un payload enorme incollato per errore prima ancora di provare a
// parsarlo - generoso per qualunque tabella reale (poche centinaia di righe
// restano ben sotto questa soglia anche con colonne verbose).
const MAX_MARKDOWN_LENGTH = 200_000;

// Tetto applicativo (non solo tecnico, stesso principio di MAX_LOT_QUANTITY
// in web/lib/account.server.ts): un file Markdown di carte comprate reale
// (vedi il contesto che ha originato questa funzionalita') e' nell'ordine
// delle decine/poche centinaia di righe. Abbassato da 500 a 150 dopo una
// review (rilievo verificato reale): applyLotImport processa le righe in
// sequenza, non in blocco, e ognuna costa piu' round-trip al DB (matching +
// upsert binder + upsert lotto) - su un host serverless con timeout la
// somma puo' superarlo prima di finire. Un'importazione parziale per
// timeout non e' distruttiva (le righe gia' scritte restano corrette, si
// puo' rilanciare lo stesso file: le righe gia' importate si limitano ad
// aggiornarsi di nuovo), ma resta un'esperienza peggiore che va evitata
// abbassando il limite piuttosto che accettandola.
const MAX_IMPORT_ROWS = 150;

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const markdown = body && typeof body === "object" ? (body as Record<string, unknown>).markdown : undefined;
  if (typeof markdown !== "string" || !markdown.trim()) {
    return NextResponse.json({ error: "Nessun testo Markdown da importare." }, { status: 400 });
  }
  if (markdown.length > MAX_MARKDOWN_LENGTH) {
    return NextResponse.json({ error: `Testo troppo lungo (${markdown.length} caratteri): il limite è ${MAX_MARKDOWN_LENGTH}.` }, { status: 400 });
  }

  const { rows, warnings } = parseLotImportMarkdown(markdown);
  if (rows.length === 0) {
    return NextResponse.json({ error: warnings[0] ?? "Nessuna riga riconosciuta nella tabella." }, { status: 400 });
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json({ error: `Troppe righe (${rows.length}): il limite per importazione è ${MAX_IMPORT_ROWS}.` }, { status: 400 });
  }

  const outcomes = await applyLotImport(userId, rows);
  return NextResponse.json({ outcomes, warnings });
}
