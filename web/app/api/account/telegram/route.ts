import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTelegramLinkStatus, unlinkTelegram } from "@/lib/account.server";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  return NextResponse.json(await getTelegramLinkStatus(userId));
}

export async function DELETE() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  await unlinkTelegram(userId);
  return NextResponse.json({ ok: true });
}
