import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createTelegramLinkCode } from "@/lib/account.server";

// NEXT_PUBLIC_*: non un segreto, solo il nome pubblico del bot (es.
// "cartaviva_bot") per costruire il link "https://t.me/<bot>?start=<codice>"
// lato client - senza, l'utente puo' comunque cercare il bot a mano su
// Telegram e mandargli "/start <codice>".
export async function POST() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { code, expiresAt } = await createTelegramLinkCode(userId);
  return NextResponse.json({
    code,
    expiresAt,
    botUsername: process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? null,
  });
}
