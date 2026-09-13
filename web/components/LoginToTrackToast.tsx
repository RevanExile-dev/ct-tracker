"use client";

/** Toast giallo, breve, mostrato quando si aggiunge una carta ai desideri (o
 * al binder, vedi useBinderPurchasePrompt) da sloggati - sia un allarme
 * prezzo (price_alerts) sia un lotto (binder_lots) sono legati a un
 * user_id, quindi in entrambi i casi ci si limita a invitare al login
 * invece di mostrare l'overlay che fallirebbe con 401. `message` permette
 * ai due chiamanti di spiegare cosa si perderebbe restando sloggati, senza
 * duplicare l'intero componente per un solo cambio di testo. */
export default function LoginToTrackToast({
  onDismiss,
  message = "Accedi per tracciare il prezzo e ricevere un avviso su Telegram quando scende.",
}: {
  onDismiss: () => void;
  message?: string;
}) {
  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 z-50 flex justify-center sm:justify-end">
      <div className="flex items-center gap-3 rounded-card border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 shadow-card max-w-sm">
        <span className="text-lg leading-none">🔔</span>
        <p className="text-sm text-ink-primary flex-1">
          {message}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Chiudi"
          className="text-ink-muted hover:text-ink-primary text-sm leading-none px-1"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
