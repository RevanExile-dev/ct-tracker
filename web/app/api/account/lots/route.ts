import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  MAX_LOT_QUANTITY, createLot, getLots, isValidLotCost, isValidLotCurrency,
  isValidLotDate, isValidLotProvenance, isValidLotQuantity,
} from "@/lib/account.server";
import type { LotInput } from "@/lib/types";

// Testo libero (note): un tetto generoso ma finito, stesso motivo di
// MAX_ENTRIES altrove - non un vincolo di prodotto, solo evitare una riga
// arbitrariamente grande scritta in una colonna TEXT.
const MAX_NOTE_LENGTH = 500;

function parseLotInput(body: unknown): { input: LotInput } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Payload non valido" };
  const v = body as Record<string, unknown>;
  const blueprintId = Number(v.blueprintId);
  if (!Number.isFinite(blueprintId)) return { error: "blueprintId mancante o non valido" };
  if (!isValidLotQuantity(v.quantity)) {
    return { error: `Quantità non valida: deve essere un intero tra 1 e ${MAX_LOT_QUANTITY}` };
  }
  if (v.provenance !== undefined && !isValidLotProvenance(v.provenance)) {
    return { error: "Provenienza non valida" };
  }
  if (v.acquiredAt !== undefined && v.acquiredAt !== null && !isValidLotDate(v.acquiredAt)) {
    return { error: "Data di acquisizione non valida (attesa YYYY-MM-DD)" };
  }
  if (v.costTotalCents !== undefined && !isValidLotCost(v.costTotalCents)) {
    return { error: "Costo non valido: deve essere un intero >= 0 (in centesimi), oppure assente" };
  }
  if (v.costCurrency !== undefined && !isValidLotCurrency(v.costCurrency)) {
    return { error: "Valuta non valida: attesa un codice ISO 4217 a 3 lettere (es. EUR), oppure assente" };
  }
  if (v.note !== undefined && v.note !== null && (typeof v.note !== "string" || v.note.length > MAX_NOTE_LENGTH)) {
    return { error: `Nota non valida (max ${MAX_NOTE_LENGTH} caratteri)` };
  }
  return {
    input: {
      blueprintId,
      quantity: v.quantity as number,
      language: typeof v.language === "string" ? v.language : null,
      condition: typeof v.condition === "string" ? v.condition : null,
      finish: typeof v.finish === "string" ? v.finish : null,
      provenance: (v.provenance as LotInput["provenance"]) ?? undefined,
      acquiredAt: (v.acquiredAt as string | undefined) ?? undefined,
      costTotalCents: v.costTotalCents === undefined ? undefined : (v.costTotalCents as number | null),
      costCurrency: (v.costCurrency as string | null | undefined) ?? null,
      note: (v.note as string | null | undefined) ?? undefined,
    },
  };
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  return NextResponse.json(await getLots(userId));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = parseLotInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const lot = await createLot(userId, parsed.input);
  return NextResponse.json(lot, { status: 201 });
}
