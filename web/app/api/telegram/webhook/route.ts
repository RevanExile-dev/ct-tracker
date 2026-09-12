import { NextRequest, NextResponse } from "next/server";
import { consumeTelegramLinkCode } from "@/lib/account.server";
import { sendTelegramMessage } from "@/lib/telegram.server";

// Endpoint pubblico chiamato da Telegram (configurato con setWebhook, vedi
// scripts/telegram_set_webhook.py) ad ogni messaggio/comando mandato al
// bot. L'URL non e' segreto per costruzione (deve essere raggiungibile da
// Telegram): l'unica verifica che la richiesta venga davvero da Telegram
// e non da chiunque la scopra e' l'header "secret_token" impostato in
// setWebhook e confrontato qui sotto - vedi
// https://core.telegram.org/bots/api#setwebhook.
const SECRET_HEADER = "x-telegram-bot-api-secret-token";

type TelegramUpdate = {
  message?: {
    text?: string;
    chat?: { id?: number };
  };
};

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expectedSecret) {
    // Il webhook non dovrebbe nemmeno essere registrato su Telegram in
    // questo stato (scripts/telegram_set_webhook.py richiede lo stesso
    // secret), ma rispondere con un errore invece di un 200 silenzioso
    // evita di processare update non verificabili se lo fosse comunque.
    return NextResponse.json({ error: "Webhook Telegram non configurato" }, { status: 503 });
  }
  if (req.headers.get(SECRET_HEADER) !== expectedSecret) {
    return NextResponse.json({ error: "Token segreto non valido" }, { status: 401 });
  }

  const update = (await req.json().catch(() => null)) as TelegramUpdate | null;
  const text = update?.message?.text?.trim();
  const chatId = update?.message?.chat?.id;

  // Da qui in poi rispondere sempre 200: un comando non riconosciuto o un
  // codice sbagliato non e' un errore del webhook (si risolve mandando un
  // messaggio di risposta all'utente), e Telegram ritenta - fino a
  // disabilitare il webhook - un endpoint che risponde con errori HTTP.
  if (!text || chatId === undefined) {
    return NextResponse.json({ ok: true });
  }

  const match = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?/i);
  if (!match) {
    return NextResponse.json({ ok: true });
  }
  const code = match[1];
  if (!code) {
    await sendTelegramMessage(
      chatId,
      "Per collegare il tuo account CartaViva, genera un codice dalla pagina " +
        "delle notifiche Telegram del tuo account e mandami qui \"/start <codice>\"."
    );
    return NextResponse.json({ ok: true });
  }

  const resolution = await consumeTelegramLinkCode(code.toUpperCase(), chatId);
  if (resolution.ok) {
    await sendTelegramMessage(
      chatId,
      "✅ Collegamento riuscito! Da ora riceverai qui i tuoi allarmi prezzo di CartaViva."
    );
  } else if (resolution.reason === "chat_already_linked_elsewhere") {
    await sendTelegramMessage(
      chatId,
      "Questa chat Telegram è già collegata a un altro account CartaViva. Scollegala prima da quell'account (pagina notifiche Telegram) per usarla qui."
    );
  } else {
    await sendTelegramMessage(
      chatId,
      "Codice non valido o scaduto: generane uno nuovo dalla pagina delle notifiche Telegram su CartaViva."
    );
  }
  return NextResponse.json({ ok: true });
}
