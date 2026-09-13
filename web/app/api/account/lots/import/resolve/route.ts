import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isValidLotCost, isValidLotDate } from "@/lib/account.server";
import { resolveImportRow } from "@/lib/lotImport.server";

/** Risoluzione manuale di UNA riga dell'import Markdown rimasta ambigua o
 * senza corrispondenza (web/components/LotImportPanel.tsx): l'utente ha
 * scelto la carta giusta (da uno dei candidati mostrati, o da una ricerca
 * libera) - qui si scrive solo quel blueprintId specifico, mai un
 * tentativo di ri-eseguire il matching automatico. */
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Payload non valido" }, { status: 400 });
  const v = body as Record<string, unknown>;

  const blueprintId = Number(v.blueprintId);
  if (!Number.isInteger(blueprintId) || blueprintId <= 0) {
    return NextResponse.json({ error: "blueprintId mancante o non valido" }, { status: 400 });
  }
  const costTotalCents = v.costTotalCents === undefined ? null : v.costTotalCents;
  if (!isValidLotCost(costTotalCents)) {
    return NextResponse.json({ error: "Costo non valido: deve essere un intero >= 0 (in centesimi), oppure assente" }, { status: 400 });
  }
  const acquiredAt = v.acquiredAt === undefined || v.acquiredAt === null ? null : v.acquiredAt;
  if (acquiredAt !== null && !isValidLotDate(acquiredAt)) {
    return NextResponse.json({ error: "Data di acquisizione non valida (attesa YYYY-MM-DD)" }, { status: 400 });
  }

  const result = await resolveImportRow(userId, blueprintId, { costTotalCents, acquiredAt });
  if (!result.ok) return NextResponse.json({ error: "Carta non trovata nel catalogo." }, { status: 404 });
  return NextResponse.json(result);
}
