import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTelegramLinkStatus, setTelegramDealAlerts, unlinkTelegram } from "@/lib/account.server";

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

// Interruttore degli avvisi "Affari veri": body { dealAlerts: boolean }.
export async function PATCH(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { dealAlerts?: unknown } | null;
  if (typeof body?.dealAlerts !== "boolean") {
    return NextResponse.json({ error: "dealAlerts deve essere true o false" }, { status: 400 });
  }
  if (!(await setTelegramDealAlerts(userId, body.dealAlerts))) {
    return NextResponse.json({ error: "Telegram non collegato" }, { status: 409 });
  }
  return NextResponse.json(await getTelegramLinkStatus(userId));
}
