import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { parseLotImportMarkdown } from "@/lib/lotImport";
import { applyLotImport } from "@/lib/lotImport.server";

// Tetto applicativo (non tecnico, stesso principio di MAX_LOT_QUANTITY in
// web/lib/account.server.ts): un file Markdown di carte comprate reale
// (vedi il contesto che ha originato questa funzionalita') e' nell'ordine
// delle decine/poche centinaia di righe - un limite piu' alto protegge solo
// da un file incollato per errore o enorme, non da un uso legittimo.
const MAX_IMPORT_ROWS = 500;

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const markdown = body && typeof body === "object" ? (body as Record<string, unknown>).markdown : undefined;
  if (typeof markdown !== "string" || !markdown.trim()) {
    return NextResponse.json({ error: "Nessun testo Markdown da importare." }, { status: 400 });
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
