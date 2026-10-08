import { NextRequest, NextResponse } from "next/server";
import {
  PriceAlertValidationError, consumeTelegramLinkCode, getPriceAlert, getUserIdByTelegramChat,
  setPriceAlertEnabled, updatePriceAlertTarget,
} from "@/lib/account.server";
import { answerTelegramCallback, sendTelegramMessage } from "@/lib/telegram.server";
import { formatCents } from "@/lib/format";

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
    reply_to_message?: { text?: string };
  };
  callback_query?: {
    id?: string;
    data?: string;
    message?: { chat?: { id?: number } };
  };
};

// Bottoni sotto l'avviso di allarme scattato: li costruisce
// drain_telegram_outbox in scripts/sync_prices_priority.py (Python), con gli
// STESSI prefissi di callback_data - tenerli allineati a mano.
//   ar:<id> = riattiva l'allarme, at:<id> = cambia soglia.
const CALLBACK_RE = /^(ar|at):(\d+)$/;
// La richiesta di nuova soglia e' un messaggio con ForceReply che contiene
// "Allarme #<id>": la risposta dell'utente porta con se' quel testo in
// reply_to_message, cosi' non serve nessuna tabella di stato per la conversazione.
const THRESHOLD_PROMPT_RE = /Allarme #(\d+): soglia attuale/;

const PLAIN = { parseMode: null } as const;

async function handleAlertCallback(callbackId: string, chatId: number, action: string, alertId: number) {
  const userId = await getUserIdByTelegramChat(chatId);
  if (!userId) {
    await answerTelegramCallback(callbackId, "Chat non collegata a un account CartaViva.");
    return;
  }
  const alert = await getPriceAlert(userId, alertId);
  if (!alert) {
    await answerTelegramCallback(callbackId, "Allarme non trovato (forse eliminato).");
    return;
  }
  if (action === "ar") {
    await setPriceAlertEnabled(userId, alertId, true);
    await answerTelegramCallback(callbackId, "Allarme riattivato ✅");
    await sendTelegramMessage(chatId, `✅ Allarme #${alertId} riattivato: ti avviso di nuovo quando raggiunge la soglia.`, PLAIN);
    return;
  }
  await answerTelegramCallback(callbackId);
  const current = alert.targetType === "absolute_cents"
    ? `${formatCents(alert.targetValue, alert.baselineCurrency ?? "EUR")}`
    : `${alert.targetValue}%`;
  const ask = alert.targetType === "absolute_cents"
    ? "Rispondi a questo messaggio con il nuovo prezzo soglia in euro (es. 12,50)."
    : "Rispondi a questo messaggio con la nuova percentuale di calo (1-99, es. 20).";
  await sendTelegramMessage(
    chatId,
    `Allarme #${alertId}: soglia attuale ${current}.\n${ask}\nSe l'allarme era scattato, torna attivo con la nuova soglia.`,
    { ...PLAIN, replyMarkup: { force_reply: true, selective: true, input_field_placeholder: "Nuova soglia" } }
  );
}

async function handleThresholdReply(chatId: number, alertId: number, text: string) {
  const userId = await getUserIdByTelegramChat(chatId);
  if (!userId) return;
  const alert = await getPriceAlert(userId, alertId);
  if (!alert) {
    await sendTelegramMessage(chatId, "Allarme non trovato (forse eliminato).", PLAIN);
    return;
  }
  const parsed = Number(text.replace(",", "."));
  const targetValue = alert.targetType === "absolute_cents" ? Math.round(parsed * 100) : parsed;
  if (!Number.isFinite(parsed)) {
    await sendTelegramMessage(chatId, "Non riesco a leggere il numero. Premi di nuovo «Cambia soglia» e riprova.", PLAIN);
    return;
  }
  try {
    const updated = await updatePriceAlertTarget(userId, alertId, targetValue);
    if (!updated) {
      await sendTelegramMessage(chatId, "Allarme non trovato (forse eliminato).", PLAIN);
      return;
    }
    const label = updated.targetType === "absolute_cents"
      ? formatCents(updated.targetValue, updated.baselineCurrency ?? "EUR")
      : `${updated.targetValue}%`;
    await sendTelegramMessage(chatId, `✅ Allarme #${alertId} aggiornato: nuova soglia ${label}. ${updated.state === "armed" ? "È attivo." : "Resta disattivato."}`, PLAIN);
  } catch (err) {
    if (err instanceof PriceAlertValidationError) {
      await sendTelegramMessage(chatId, `${err.message} Premi di nuovo «Cambia soglia» e riprova.`, PLAIN);
      return;
    }
    throw err;
  }
}

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

  // Bottoni inline dell'avviso di allarme (riattiva / cambia soglia).
  const cb = update?.callback_query;
  if (cb) {
    const cbChatId = cb.message?.chat?.id;
    const m = typeof cb.data === "string" ? cb.data.match(CALLBACK_RE) : null;
    if (typeof cb.id === "string" && typeof cbChatId === "number" && m) {
      await handleAlertCallback(cb.id, cbChatId, m[1], Number(m[2]));
    } else if (typeof cb.id === "string") {
      await answerTelegramCallback(cb.id);
    }
    return NextResponse.json({ ok: true });
  }

  const text = update?.message?.text?.trim();
  const chatId = update?.message?.chat?.id;

  // Da qui in poi rispondere sempre 200: un comando non riconosciuto o un
  // codice sbagliato non e' un errore del webhook (si risolve mandando un
  // messaggio di risposta all'utente), e Telegram ritenta - fino a
  // disabilitare il webhook - un endpoint che risponde con errori HTTP.
  // "typeof chatId !== 'number'" (non solo "=== undefined", rilievo di
  // review su questa PR): un payload malformato con chat.id = null
  // supererebbe un controllo solo su undefined, arrivando fino a
  // consumeTelegramLinkCode con un chat_id non valido (violazione del
  // NOT NULL su telegram_links.chat_id, mai gestita da nessuna parte).
  if (!text || typeof chatId !== "number") {
    return NextResponse.json({ ok: true });
  }

  // Ancorato con "$" (rilievo di review su questa PR): senza, "/start_help"
  // o "/starting" combacerebbero comunque con il solo prefisso "/start" (il
  // testo e' gia' stato "trim()-ato" sopra, quindi l'ancora di fine
  // stringa non esclude nessun caso legittimo), facendo rispondere con il
  // messaggio "manda /start <codice>" a un comando che non c'entra nulla.
  // Risposta alla richiesta di nuova soglia (vedi THRESHOLD_PROMPT_RE).
  const prompt = update?.message?.reply_to_message?.text?.match(THRESHOLD_PROMPT_RE);
  if (prompt && !text.startsWith("/")) {
    await handleThresholdReply(chatId, Number(prompt[1]), text);
    return NextResponse.json({ ok: true });
  }

  const match = text.match(/^\/start(?:@\w+)?(?:\s+(\S+))?$/i);
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
