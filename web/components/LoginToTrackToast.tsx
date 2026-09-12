"use client";

/** Toast giallo, breve, mostrato quando si aggiunge una carta ai desideri
 * da sloggati - un allarme prezzo non puo' esistere senza account (vive in
 * price_alerts, per user_id), quindi qui ci si limita a invitare al login
 * invece di mostrare l'overlay di QuickAlertModal (che fallirebbe con 401). */
export default function LoginToTrackToast({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-4 z-50 flex justify-center sm:justify-end">
      <div className="flex items-center gap-3 rounded-card border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 shadow-card max-w-sm">
        <span className="text-lg leading-none">🔔</span>
        <p className="text-sm text-ink-primary flex-1">
          Accedi per tracciare il prezzo e ricevere un avviso su Telegram quando scende.
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
