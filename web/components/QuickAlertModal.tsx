"use client";

import { useEffect, useState } from "react";
import type { CardRow } from "@/lib/types";
import type { PriceAlertTargetType } from "@/lib/types";
import { formatCents } from "@/lib/format";

/** Overlay rapida per creare un allarme prezzo su UNA carta gia' nota (id +
 * nome + prezzo attuale), senza passare dalla ricerca di /account/alerts.
 * Volutamente minimale: solo tipo+valore soglia, lingua/condizione/Zero
 * sempre "qualunque" e fireMode sempre "once" - chi vuole di piu' (cooldown,
 * profilo specifico) usa comunque la pagina /account/alerts, che resta
 * intatta e piu' completa. Aperta da due punti diversi (vedi
 * useWishlistAlertPrompt.tsx e la pagina carta): il chiamante decide cosa
 * fare dopo submit/skip/chiudi, questo componente non tocca mai i desideri. */
export default function QuickAlertModal({
  card,
  onClose,
  onCreated,
}: {
  card: CardRow;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const currentCents = card.best_price_cents ?? card.latest_price_cents ?? null;
  const currentCurrency = card.best_price_currency ?? card.latest_price_currency ?? "EUR";

  const [targetType, setTargetType] = useState<PriceAlertTargetType>("absolute_cents");
  const [targetInput, setTargetInput] = useState("");
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

    let targetValue: number;
    if (targetType === "absolute_cents") {
      const parsed = Number(targetInput.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed <= 0) { setError("Prezzo soglia non valido."); return; }
      targetValue = Math.round(parsed * 100);
    } else {
      const parsed = Number(targetInput);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed >= 100) { setError("Percentuale di calo non valida (1-99)."); return; }
      targetValue = parsed;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/account/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blueprintId: card.id,
          targetType,
          targetValue,
          fireMode: "once",
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Errore (${res.status}).`);
        return;
      }
      setDone(true);
      onCreated?.();
    } catch {
      setError("Errore di rete. Riprova tra poco.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-card border border-base-border bg-base-surface shadow-card p-5">
        {done ? (
          <>
            <div className="text-ink-primary font-medium">🔔 Allarme creato</div>
            <p className="text-sm text-ink-muted mt-2">
              Ti avviseremo su Telegram quando il prezzo di <span className="text-ink-primary">{card.name}</span> raggiunge la soglia impostata.
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
            <div className="text-ink-primary font-medium">Vuoi tracciarla?</div>
            <p className="text-sm text-ink-muted mt-1">
              Ricevi un avviso su Telegram quando il prezzo di <span className="text-ink-primary">{card.name}</span> scende sotto una soglia.
            </p>
            {currentCents !== null && (
              <p className="text-xs font-mono text-ink-faint mt-2">
                Prezzo attuale: {formatCents(currentCents, currentCurrency)}
              </p>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-3">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setTargetType("absolute_cents")}
                  className={`flex-1 text-xs font-mono uppercase tracking-wider px-3 py-2 rounded-card border transition-colors ${
                    targetType === "absolute_cents"
                      ? "bg-accent/10 border-accent/60 text-accent-bright"
                      : "bg-base-surface2 border-base-border text-ink-muted"
                  }`}
                >
                  Prezzo fisso
                </button>
                <button
                  type="button"
                  onClick={() => setTargetType("percent_drop")}
                  className={`flex-1 text-xs font-mono uppercase tracking-wider px-3 py-2 rounded-card border transition-colors ${
                    targetType === "percent_drop"
                      ? "bg-accent/10 border-accent/60 text-accent-bright"
                      : "bg-base-surface2 border-base-border text-ink-muted"
                  }`}
                >
                  Calo %
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  placeholder={targetType === "absolute_cents" ? "es. 10,00" : "es. 20"}
                  className="flex-1 rounded-card border border-base-border bg-base-surface2 px-3 py-2 text-sm text-ink-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                  autoFocus
                />
                <span className="text-sm text-ink-muted">{targetType === "absolute_cents" ? currentCurrency : "%"}</span>
              </div>

              {error && <p className="text-xs text-signal-down">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 text-sm px-4 py-2.5 rounded-card border border-base-border bg-base-surface2 text-ink-muted hover:text-ink-primary transition-colors active:scale-95"
                >
                  Salta, solo desideri
                </button>
                <button
                  type="submit"
                  disabled={submitting || !targetInput}
                  className="flex-1 text-sm px-4 py-2.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 transition-colors active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                >
                  {submitting ? "..." : "Traccia"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
