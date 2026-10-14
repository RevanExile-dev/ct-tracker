/** Errore di caricamento dati, uguale in tutte le pagine: messaggio comprensibile,
 * "Riprova" e il testo tecnico dietro "Dettagli tecnici" (prima movers, desideri,
 * binder e scheda carta mostravano direttamente "Richiesta a /api/... fallita (500)"
 * senza alcun modo di riprovare). */
export default function LoadError({
  title,
  detail,
  onRetry,
  className = "mt-8",
}: {
  title: string;
  detail: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div role="alert" data-testid="load-error" className={`${className} rounded-card border border-signal-down/30 bg-signal-down/5 p-5`}>
      <div className="text-signal-down font-display font-medium">{title}</div>
      <p className="text-ink-muted mt-1.5 text-sm">
        Può essere un problema di connessione temporaneo — riprova tra qualche secondo.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="btn-lift mt-4 min-h-11 text-sm px-4 py-2 rounded-card border border-signal-down/40 text-signal-down hover:bg-signal-down/10 transition-colors active:scale-95"
      >
        Riprova
      </button>
      <details className="mt-3 text-xs text-ink-faint">
        <summary className="cursor-pointer select-none">Dettagli tecnici</summary>
        <div className="mt-1 font-mono break-all">{detail}</div>
      </details>
    </div>
  );
}
