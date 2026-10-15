import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTelegramLinkStatus, setWeeklyDigest, unlinkTelegram } from "@/lib/account.server";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  return NextResponse.json(await getTelegramLinkStatus(userId));
}

export async function PATCH(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const body = await req.json().catch(() => null) as { weeklyDigest?: unknown } | null;
  if (typeof body?.weeklyDigest !== "boolean") {
    return NextResponse.json({ error: "weeklyDigest deve essere true o false" }, { status: 400 });
  }
  if (!(await setWeeklyDigest(userId, body.weeklyDigest))) {
    return NextResponse.json({ error: "Telegram non collegato" }, { status: 409 });
  }
  return NextResponse.json({ ok: true, weeklyDigest: body.weeklyDigest });
}

export async function DELETE() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  await unlinkTelegram(userId);
  return NextResponse.json({ ok: true });
}
