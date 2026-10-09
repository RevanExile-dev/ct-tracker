import "server-only";

// Wrapper minimo sull'API Bot di Telegram, condiviso da:
// - web/app/api/telegram/webhook/route.ts (conferma il collegamento account)
// - il futuro worker allarmi prezzo (punto 4c del piano)
// Lo script Python scripts/notify_telegram.py fa la stessa identica
// chiamata HTTP per la watchlist legacy, ma vive in un processo separato
// (GitHub Actions) - nessun codice condiviso possibile tra Python e questo
// modulo Next.js, da qui la duplicazione minima dell'endpoint.

const TELEGRAM_API_BASE = "https://api.telegram.org";

export type TelegramSendResult = { ok: true } | { ok: false; error: string };

/** Manda un messaggio Telegram. Non lancia mai un'eccezione: un invio
 * fallito (token mancante, chat_id invalido, rete) non deve mai far
 * fallire la richiesta che lo ha scatenato - es. il webhook di
 * collegamento deve comunque rispondere 200 a Telegram anche se il
 * messaggio di conferma non parte, altrimenti Telegram ritenta l'update
 * (che nel frattempo e' gia' stato applicato: il codice e' gia' stato
 * consumato) e alla lunga puo' disabilitare il webhook per troppi errori. */
export type TelegramSendOptions = {
  /** Default "Markdown" (i testi fissi del webhook). Per testi con valori
   * dinamici (es. nomi di carte) passare null: testo semplice, niente rischio
   * che un "_" o "*" faccia rifiutare il messaggio. Il messaggio d'avviso
   * Python (scripts/db.py) usa invece HTML: formati diversi per runtime. */
  parseMode?: "Markdown" | null;
  replyMarkup?: Record<string, unknown>;
};

export async function sendTelegramMessage(
  chatId: number, text: string, options: TelegramSendOptions = {}
): Promise<TelegramSendResult> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN non configurato" };
  try {
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        ...(options.parseMode === null ? {} : { parse_mode: options.parseMode ?? "Markdown" }),
        ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `${res.status} ${body}`.trim() };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Chiude il "caricamento" del bottone inline premuto (obbligatorio, altrimenti
 * il client Telegram mostra la rotellina per qualche secondo); `text` appare
 * come breve avviso. Come sendTelegramMessage non lancia mai. */
export async function answerTelegramCallback(callbackQueryId: string, text?: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  try {
    await fetch(`${TELEGRAM_API_BASE}/bot${token}/answerCallbackQuery`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callback_query_id: callbackQueryId, ...(text ? { text } : {}) }),
    });
  } catch {
    // niente da fare: il bottone smette comunque di girare da solo
  }
}
