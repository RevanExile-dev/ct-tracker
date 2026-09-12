import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  MAX_LOT_QUANTITY, deleteLot, isValidLotCost, isValidLotCurrency, isValidLotDate,
  isValidLotProvenance, isValidLotQuantity, updateLot,
} from "@/lib/account.server";
import type { LotInput } from "@/lib/types";

const MAX_NOTE_LENGTH = 500;
// Nessuna UI oggi patcha questi campi con un valore libero (il form di
// /lots imposta solo "language" alla creazione), ma l'endpoint resta
// raggiungibile direttamente: senza un controllo di tipo qui, un payload
// come {"language": {"bad": true}} passerebbe indenne (node-postgres
// serializza silenziosamente un oggetto/numero a stringa con JSON.stringify
// invece di lanciare un errore, verificato con una query reale) e finirebbe
// scritto cosi' com'e' nella colonna - innocuo a runtime (non trova mai
// corrispondenza in price_listings.language, quindi ricade sul "best"
// generale) ma comunque un dato spazzatura che la POST invece rifiuta gia'
// con lo stesso identico controllo. Stesso tetto di lunghezza across i tre,
// generoso per qualunque valore reale di lingua/condizione/finitura.
const MAX_SHORT_FIELD_LENGTH = 40;

function isNullableShortString(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length <= MAX_SHORT_FIELD_LENGTH);
}

/** Patch parziale: ogni campo presente deve essere valido, ma nessuno e'
 * obbligatorio (a differenza di POST /lots) - stesso principio di PUT
 * /binder/[id]. */
function parseLotPatch(body: unknown): { patch: Partial<Omit<LotInput, "blueprintId">> } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Payload non valido" };
  const v = body as Record<string, unknown>;
  if ("quantity" in v && !isValidLotQuantity(v.quantity)) {
    return { error: `Quantità non valida: deve essere un intero tra 1 e ${MAX_LOT_QUANTITY}` };
  }
  if ("language" in v && !isNullableShortString(v.language)) {
    return { error: `Lingua non valida (stringa di massimo ${MAX_SHORT_FIELD_LENGTH} caratteri, oppure null)` };
  }
  if ("condition" in v && !isNullableShortString(v.condition)) {
    return { error: `Condizione non valida (stringa di massimo ${MAX_SHORT_FIELD_LENGTH} caratteri, oppure null)` };
  }
  if ("finish" in v && !isNullableShortString(v.finish)) {
    return { error: `Finitura non valida (stringa di massimo ${MAX_SHORT_FIELD_LENGTH} caratteri, oppure null)` };
  }
  if ("provenance" in v && !isValidLotProvenance(v.provenance)) {
    return { error: "Provenienza non valida" };
  }
  if ("acquiredAt" in v && !isValidLotDate(v.acquiredAt)) {
    return { error: "Data di acquisizione non valida (attesa YYYY-MM-DD)" };
  }
  if ("costTotalCents" in v && !isValidLotCost(v.costTotalCents)) {
    return { error: "Costo non valido: deve essere un intero >= 0 (in centesimi) oppure null" };
  }
  if ("costCurrency" in v && !isValidLotCurrency(v.costCurrency)) {
    return { error: "Valuta non valida: attesa un codice ISO 4217 a 3 lettere (es. EUR), oppure null" };
  }
  if ("note" in v && v.note !== null && (typeof v.note !== "string" || v.note.length > MAX_NOTE_LENGTH)) {
    return { error: `Nota non valida (max ${MAX_NOTE_LENGTH} caratteri)` };
  }
  const patch: Partial<Omit<LotInput, "blueprintId">> = {};
  if ("quantity" in v) patch.quantity = v.quantity as number;
  if ("language" in v) patch.language = v.language as string | null;
  if ("condition" in v) patch.condition = v.condition as string | null;
  if ("finish" in v) patch.finish = v.finish as string | null;
  if ("provenance" in v) patch.provenance = v.provenance as LotInput["provenance"];
  if ("acquiredAt" in v) patch.acquiredAt = v.acquiredAt as string;
  if ("costTotalCents" in v) patch.costTotalCents = v.costTotalCents as number | null;
  if ("costCurrency" in v) patch.costCurrency = (v.costCurrency as string | null) ?? null;
  if ("note" in v) patch.note = (v.note as string | null) ?? null;
  return { patch };
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = parseLotPatch(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const lot = await updateLot(userId, id, parsed.patch);
  if (!lot) return NextResponse.json({ error: "Lotto non trovato" }, { status: 404 });
  return NextResponse.json(lot);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id } = await params;
  await deleteLot(userId, id);
  return NextResponse.json({ ok: true });
}
