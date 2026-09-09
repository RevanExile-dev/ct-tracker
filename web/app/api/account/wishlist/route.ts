import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getWishlistIds, mergeWishlistIds } from "@/lib/account.server";

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
  if (!Array.isArray(body) || !body.every((v) => typeof v === "number" && Number.isFinite(v))) {
    return NextResponse.json({ error: "Payload non valido" }, { status: 400 });
  }
  await mergeWishlistIds(userId, body);
  return NextResponse.json(await getWishlistIds(userId));
}
