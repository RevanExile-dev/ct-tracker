import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { addWishlistId, removeWishlistId } from "@/lib/account.server";

export async function PUT(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id } = await params;
  const blueprintId = Number(id);
  if (!Number.isFinite(blueprintId)) return NextResponse.json({ error: "Id non valido" }, { status: 400 });
  await addWishlistId(userId, blueprintId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id } = await params;
  const blueprintId = Number(id);
  if (!Number.isFinite(blueprintId)) return NextResponse.json({ error: "Id non valido" }, { status: 400 });
  await removeWishlistId(userId, blueprintId);
  return NextResponse.json({ ok: true });
}
