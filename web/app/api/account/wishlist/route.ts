import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getWishlistIds, mergeWishlistIds } from "@/lib/account.server";
import { limitErrorResponse } from "@/lib/accountLimitResponse";
import { MAX_WISHLIST_CARDS, isValidBlueprintId } from "@/lib/accountLimits";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  return NextResponse.json(await getWishlistIds(userId));
}

/** Merge bulk usato una sola volta al login (web/lib/wishlist.ts,
 * syncWishlistWithServer): il client ha gia' calcolato l'unione locale+
 * server. */
export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body) || body.length > MAX_WISHLIST_CARDS || !body.every(isValidBlueprintId)) {
    return NextResponse.json({ error: "Payload non valido" }, { status: 400 });
  }
  try {
    await mergeWishlistIds(userId, body);
  } catch (err) {
    const limited = limitErrorResponse(err);
    if (limited) return limited;
    throw err;
  }
  return NextResponse.json(await getWishlistIds(userId));
}
