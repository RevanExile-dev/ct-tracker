"use client";

import { useEffect, useState } from "react";
import type { CardRow } from "@/lib/types";
import type { Lot, LotProvenance } from "@/lib/types";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

type Mode = "acquisto" | "pacchetto";

/** Overlay per registrare COME e' arrivata una carta nel binder: comprata
 * (prezzo + data, diventa un lotto con provenance "acquisto") oppure
 * spacchettata/trovata (nessun prezzo di partenza ha senso, provenance
 * "pacchetto") - scrive su binder_lots, riusando l'intera infrastruttura
 * gia' presente per /lots (vedi web/app/lots/page.tsx), qui aperta dal
 * momento in cui la carta viene aggiunta al binder invece che da una pagina
 * separata. Stessa forma/stati di QuickAlertModal.tsx (overlay/escape/
 * backdrop-click/submitting-error-done) - copiata deliberatamente per
 * coerenza visiva, non condivisa perche' i due form non hanno campi in
 * comune.
 *
 * `existingLot`, se passato, mette il form in modalita' modifica (PUT
 * invece di POST): usato dal pulsante "Dettagli acquisto" nel binder per le
 * carte aggiunte prima che questo popup esistesse - stesso form, stesso
 * componente, l'unica differenza e' la richiesta HTTP finale. */
export default function LogPurchaseModal({
  card,
  existingLot,
  onClose,
  onSaved,
}: {
  card: CardRow;
  existingLot?: Lot | null;
  onClose: () => void;
  onSaved?: (lot: Lot) => void;
}) {
  const isEditing = !!existingLot;
  const [mode, setMode] = useState<Mode>(
    existingLot?.provenance === "pacchetto" ? "pacchetto" : "acquisto"
  );
  const [costInput, setCostInput] = useState(
    existingLot?.costTotalCents != null ? (existingLot.costTotalCents / 100).toFixed(2) : ""
  );
  const [acquiredAt, setAcquiredAt] = useState(existingLot?.acquiredAt ?? todayIso());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    let costTotalCents: number | null = null;
    if (mode === "acquisto") {
      const parsed = Number(costInput.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed < 0) { setError("Prezzo non valido."); return; }
      costTotalCents = Math.round(parsed * 100);
    }
    const provenance: LotProvenance = mode;

    setSubmitting(true);
    try {
      const res = existingLot
        ? await fetch(`/api/account/lots/${existingLot.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provenance,
              acquiredAt,
              costTotalCents,
              costCurrency: costTotalCents !== null ? "EUR" : null,
            }),
          })
        : await fetch("/api/account/lots", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              blueprintId: card.id,
              quantity: 1,
              provenance,
              acquiredAt,
              costTotalCents,
              costCurrency: costTotalCents !== null ? "EUR" : null,
            }),
          });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Errore (${res.status}).`);
        return;
      }
      const lot: Lot = await res.json();
      setDone(true);
      onSaved?.(lot);
    } catch {
      setError("Errore di rete. Riprova tra poco.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-card border border-base-border bg-base-surface shadow-card p-5 max-h-[90vh] overflow-y-auto">
        {done ? (
          <>
            <div className="text-ink-primary font-medium">★ Salvato</div>
            <p className="text-sm text-ink-muted mt-2">
              {mode === "acquisto"
                ? <>Registrato il prezzo di acquisto di <span className="text-ink-primary">{card.name}</span>: lo trovi anche in <span className="text-ink-primary">/lotti</span>, con la plusvalenza rispetto al prezzo di mercato attuale.</>
                : <><span className="text-ink-primary">{card.name}</span> segnata come spacchettata/trovata, senza prezzo di partenza.</>}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-4 w-full text-sm px-4 py-2.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 transition-colors active:scale-95"
            >
              Chiudi
            </button>
          </>
        ) : (
          <>
            <div className="text-ink-primary font-medium">{isEditing ? "Dettagli acquisto" : "L'hai comprata o spacchettata?"}</div>
            <p className="text-sm text-ink-muted mt-1">
              <span className="text-ink-primary">{card.name}</span>
              {!isEditing && " è nel tuo binder. Vuoi registrare un prezzo di partenza per vedere se ci stai guadagnando o perdendo?"}
            </p>

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("acquisto")}
                  className={`flex-1 text-xs font-mono uppercase tracking-wider px-3 py-2 rounded-card border transition-colors ${
                    mode === "acquisto"
                      ? "bg-accent/10 border-accent/60 text-accent-bright"
                      : "bg-base-surface2 border-base-border text-ink-muted"
                  }`}
                >
                  Comprata
                </button>
                <button
                  type="button"
                  onClick={() => setMode("pacchetto")}
                  className={`flex-1 text-xs font-mono uppercase tracking-wider px-3 py-2 rounded-card border transition-colors ${
                    mode === "pacchetto"
                      ? "bg-accent/10 border-accent/60 text-accent-bright"
                      : "bg-base-surface2 border-base-border text-ink-muted"
                  }`}
                >
                  Spacchettata / trovata
                </button>
              </div>

              {mode === "acquisto" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs text-ink-faint mb-1" htmlFor="purchase-cost">Prezzo pagato</label>
                    <div className="flex items-center gap-2">
                      <input
                        id="purchase-cost"
                        type="text"
                        inputMode="decimal"
                        value={costInput}
                        onChange={(e) => setCostInput(e.target.value)}
                        placeholder="es. 12,50"
                        autoFocus
                        className="flex-1 min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                      />
                      <span className="text-sm text-ink-muted">EUR</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-ink-faint mb-1" htmlFor="purchase-date">Data</label>
                    <input
                      id="purchase-date"
                      type="date"
                      value={acquiredAt}
                      max={todayIso()}
                      onChange={(e) => setAcquiredAt(e.target.value)}
                      className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs text-ink-faint mb-1" htmlFor="purchase-date-pack">Data (opzionale)</label>
                  <input
                    id="purchase-date-pack"
                    type="date"
                    value={acquiredAt}
                    max={todayIso()}
                    onChange={(e) => setAcquiredAt(e.target.value)}
                    className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                  />
                  <p className="text-xs text-ink-faint mt-1.5">Nessun prezzo di partenza: il binder mostrerà solo il valore di mercato per questa copia.</p>
                </div>
              )}

              {error && <p role="alert" className="text-xs text-signal-down">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 text-sm px-4 py-2.5 rounded-card border border-base-border bg-base-surface2 text-ink-muted hover:text-ink-primary transition-colors active:scale-95"
                >
                  Salta
                </button>
                <button
                  type="submit"
                  disabled={submitting || (mode === "acquisto" && !costInput)}
                  className="flex-1 text-sm px-4 py-2.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 transition-colors active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                >
                  {submitting ? "..." : "Salva"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
