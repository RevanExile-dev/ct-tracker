"use client";

import Link from "next/link";

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
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 z-50 flex justify-center sm:justify-end" data-testid="login-toast">
      {/* Sfondo pieno: con yellow-500/10 (trasparente) il testo si sovrapponeva
          a quello della pagina sotto e non si leggeva (provato su telefono). */}
      <div
        role="status"
        className="flex items-start gap-3 rounded-card border border-yellow-500/60 bg-base-surface2 px-4 py-3 shadow-card max-w-sm w-full"
      >
        <span className="text-lg leading-none mt-1" aria-hidden>🔔</span>
        <div className="flex-1">
          <p className="text-sm text-ink-primary">{message}</p>
          <Link
            href="/login"
            className="btn-lift mt-2 inline-flex items-center min-h-11 px-4 text-sm rounded-card border border-accent/40 bg-accent/10 text-accent-bright hover:border-accent/70"
          >
            Accedi
          </Link>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Chiudi"
          className="text-ink-muted hover:text-ink-primary text-sm leading-none min-h-11 min-w-11 -mr-2 -mt-1"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
