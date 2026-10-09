import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { limitErrorResponse } from "@/lib/accountLimitResponse";
import { isValidBlueprintId, pickBinderPatch } from "@/lib/accountLimits";
import { MAX_BINDER_QUANTITY, isValidBinderQuantity, upsertBinderEntry, deleteBinderEntry } from "@/lib/account.server";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id } = await params;
  const blueprintId = Number(id);
  if (!isValidBlueprintId(blueprintId)) return NextResponse.json({ error: "Id non valido" }, { status: 400 });
  const rawPatch = await req.json().catch(() => ({}));
  // patch e' parziale (es. lo scanner invia solo { language }): "quantity"
  // e' opzionale qui, ma se presente deve essere valida - altrimenti
  // finirebbe cosi' com'e' nel JSONB data e servirebbe poi a
  // snapshot_binder_values() in scripts/db.py, che la scarta silenziosamente
  // (fallback a 1) invece di rompersi, ma un errore qui e' piu' onesto
  // verso il chiamante che non un salvataggio silenzioso di un valore
  // scartato altrove.
  if (rawPatch && typeof rawPatch === "object" && "quantity" in rawPatch && !isValidBinderQuantity(rawPatch.quantity)) {
    return NextResponse.json({ error: `Quantità non valida: deve essere un intero tra 1 e ${MAX_BINDER_QUANTITY}` }, { status: 400 });
  }
  // Solo i campi che il binder usa davvero (vedi lib/accountLimits.ts).
  const picked = pickBinderPatch(rawPatch);
  if ("error" in picked) return NextResponse.json({ error: picked.error }, { status: 400 });
  try {
    const entry = await upsertBinderEntry(userId, blueprintId, picked.patch);
    return NextResponse.json(entry);
  } catch (err) {
    const limited = limitErrorResponse(err);
    if (limited) return limited;
    throw err;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id } = await params;
  const blueprintId = Number(id);
  if (!Number.isFinite(blueprintId)) return NextResponse.json({ error: "Id non valido" }, { status: 400 });
  await deleteBinderEntry(userId, blueprintId);
  return NextResponse.json({ ok: true });
}
