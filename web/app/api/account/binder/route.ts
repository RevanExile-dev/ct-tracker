import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getBinderEntries, isValidBinderQuantity, mergeBinderEntries } from "@/lib/account.server";
import { limitErrorResponse } from "@/lib/accountLimitResponse";
import { MAX_BINDER_CARDS, isValidBlueprintId } from "@/lib/accountLimits";
import type { BinderEntry } from "@/lib/binder";

function isBinderEntry(value: unknown): value is BinderEntry {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  // A differenza di PUT /[id] (patch parziale), qui ogni entry sostituisce
  // per intero la riga corrispondente (vedi mergeBinderEntries) - quantity
  // deve quindi essere sempre valida, non solo se presente.
  return isValidBlueprintId(v.blueprintId) && isValidBinderQuantity(v.quantity);
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  return NextResponse.json(await getBinderEntries(userId));
}

/** Merge bulk usato una sola volta al login (web/lib/binder.ts,
 * syncBinderWithServer): il client ha gia' calcolato l'unione locale+
 * server, qui si scrive quel risultato cosi' com'e'. */
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body) || body.length > MAX_BINDER_CARDS || !body.every(isBinderEntry)) {
    return NextResponse.json({ error: "Payload non valido" }, { status: 400 });
  }
  try {
    await mergeBinderEntries(userId, body);
  } catch (err) {
    const limited = limitErrorResponse(err);
    if (limited) return limited;
    throw err;
  }
  return NextResponse.json(await getBinderEntries(userId));
}
