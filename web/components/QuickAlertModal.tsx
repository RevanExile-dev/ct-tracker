"use client";

import { useEffect, useState } from "react";
import { useDialogA11y } from "@/lib/useDialogA11y";
import AlertLanguagePicker from "@/components/AlertLanguagePicker";
import type { CardRow, PriceAlert, PriceAlertFireMode, PriceAlertTargetType } from "@/lib/types";
import { fetchConditions, fetchLanguages } from "@/lib/db";
import { formatCents } from "@/lib/format";

const ANY_OPTION = ""; // select vuoto = "qualunque" (stesso valore sentinella di /account/alerts)

// In modifica le opzioni arrivano da una fetch asincrona: finche' non sono
// caricate (o se il valore salvato non e' piu' tra quelle offerte) il valore
// corrente deve comunque esistere nella select, altrimenti React la mostra
// su "Qualunque" e un Salva silenzioso lo sovrascriverebbe.
function withCurrent(options: string[], current: string): string[] {
  return current && !options.includes(current) ? [current, ...options] : options;
}

/** Overlay rapida per creare (o, con `alert`, MODIFICARE)  un allarme prezzo su UNA carta gia' nota (id +
 * nome + prezzo attuale), senza passare dalla ricerca di /account/alerts.
 * Stessi controlli di profilo (lingua/condizione/CardTrader Zero) della
 * pagina completa, qui senza bisogno di cercare la carta - fireMode resta
 * sempre "once" (chi vuole un allarme ripetibile con cooldown usa comunque
 * /account/alerts). Aperta da due punti diversi (vedi
 * useWishlistAlertPrompt.tsx e la pagina carta): il chiamante decide cosa
 * fare dopo submit/skip/chiudi, questo componente non tocca mai i desideri.
 *
 * Modalita' modifica (`alert` presente, usata da /account/alerts): campi
 * precompilati dall'allarme, PATCH invece di POST, e in piu' "Quando scatta"
 * (una volta / ripetibile) che in creazione rapida resta sempre "once" -
 * senza, modificare un allarme ripetibile ne azzererebbe in silenzio la
 * modalita'. `card` puo' mancare (la lista allarmi la carica in modo
 * asincrono): in quel caso titolo e valuta ripiegano sui dati dell'allarme. */
export default function QuickAlertModal({
  card,
  alert,
  onClose,
  onCreated,
  onSaved,
}: {
  card?: CardRow;
  alert?: PriceAlert;
  onClose: () => void;
  onCreated?: () => void;
  onSaved?: (updated: PriceAlert) => void;
}) {
  const editing = alert !== undefined;
  const cardName = card?.name ?? (alert ? `Carta #${alert.blueprintId}` : "");
  const currentCents = card ? (card.best_price_cents ?? card.latest_price_cents ?? null) : null;
  const currentCurrency =
    (card ? (card.best_price_currency ?? card.latest_price_currency) : null) ?? alert?.baselineCurrency ?? "EUR";

  const [languages, setLanguages] = useState<string[]>(alert?.languages ?? []);
  const [condition, setCondition] = useState(alert?.condition ?? ANY_OPTION);
  const [canSellViaHub, setCanSellViaHub] = useState<"any" | "only" | "never">(
    alert ? (alert.canSellViaHub === 1 ? "only" : alert.canSellViaHub === 0 ? "never" : "any") : "any"
  );
  const [languageOptions, setLanguageOptions] = useState<string[]>([]);
  const [conditionOptions, setConditionOptions] = useState<string[]>([]);

  const [targetType, setTargetType] = useState<PriceAlertTargetType>(alert?.targetType ?? "absolute_cents");
  const [targetInput, setTargetInput] = useState(
    !alert ? "" : alert.targetType === "absolute_cents"
      ? (alert.targetValue / 100).toFixed(2).replace(".", ",")
      : String(alert.targetValue)
  );
  const [fireMode, setFireMode] = useState<PriceAlertFireMode>(alert?.fireMode ?? "once");
  const [rearmCooldownHours, setRearmCooldownHours] = useState(String(alert?.rearmCooldownHours ?? 24));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const dialogRef = useDialogA11y<HTMLDivElement>();

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchLanguages(), fetchConditions()])
      .then(([langs, conds]) => { if (!cancelled) { setLanguageOptions(langs); setConditionOptions(conds); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

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

    let rearmHours: number | undefined;
    if (editing && fireMode === "rearm") {
      const parsed = Number(rearmCooldownHours);
      if (!Number.isInteger(parsed) || parsed < 1) { setError("Ore di attesa (cooldown) non valide."); return; }
      rearmHours = parsed;
    }

    setSubmitting(true);
    try {
      const res = await fetch(editing ? `/api/account/alerts/${alert.id}` : "/api/account/alerts", {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(editing ? {} : { blueprintId: card?.id }),
          languages,
          condition: condition || null,
          canSellViaHub: canSellViaHub === "any" ? null : canSellViaHub === "only" ? 1 : 0,
          targetType,
          targetValue,
          fireMode: editing ? fireMode : "once",
          rearmCooldownHours: rearmHours,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? `Errore (${res.status}).`);
        return;
      }
      if (editing) {
        onSaved?.(await res.json());
        onClose();
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
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={editing ? "Modifica allarme di prezzo" : "Crea allarme di prezzo"} tabIndex={-1} className="relative w-full max-w-md rounded-card border border-base-border bg-base-surface shadow-card p-5 max-h-[90vh] overflow-y-auto">
        {done ? (
          <>
            <div className="text-ink-primary font-medium">🔔 Allarme creato</div>
            <p className="text-sm text-ink-muted mt-2">
              Ti avviseremo su Telegram quando il prezzo di <span className="text-ink-primary">{cardName}</span> raggiunge la soglia impostata.
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
            <div className="text-ink-primary font-medium">{editing ? "Modifica allarme" : "Vuoi tracciarla?"}</div>
            <p className="text-sm text-ink-muted mt-1">
              {editing
                ? <>Cambia profilo e soglia dell&apos;allarme su <span className="text-ink-primary">{cardName}</span>.</>
                : <>Ricevi un avviso su Telegram quando il prezzo di <span className="text-ink-primary">{cardName}</span> scende sotto una soglia.</>}
            </p>
            {currentCents !== null && (
              <p className="text-xs font-mono text-ink-faint mt-2">
                Prezzo attuale: {formatCents(currentCents, currentCurrency)}
              </p>
            )}

            <form onSubmit={handleSubmit} className="mt-4 space-y-4">
              <div>
                <div className="text-xs font-mono uppercase tracking-wider text-ink-faint mb-2">Profilo</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <AlertLanguagePicker idPrefix="quick-alert-language" options={languageOptions} selected={languages} onChange={setLanguages} />
                  </div>
                  <div>
                    <label className="block text-xs text-ink-faint mb-1" htmlFor="quick-alert-condition">Condizione</label>
                    <select
                      id="quick-alert-condition"
                      value={condition}
                      onChange={(e) => setCondition(e.target.value)}
                      className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                    >
                      <option value={ANY_OPTION}>Qualunque condizione</option>
                      {withCurrent(conditionOptions, condition).map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs text-ink-faint mb-1" htmlFor="quick-alert-hub">CardTrader Zero</label>
                    <select
                      id="quick-alert-hub"
                      value={canSellViaHub}
                      onChange={(e) => setCanSellViaHub(e.target.value as typeof canSellViaHub)}
                      className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                    >
                      <option value="any">Indifferente</option>
                      <option value="only">Solo CardTrader Zero</option>
                      <option value="never">Mai CardTrader Zero</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <div className="text-xs font-mono uppercase tracking-wider text-ink-faint mb-2">Soglia</div>
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

                <div className="flex items-center gap-2 mt-2">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={targetInput}
                    onChange={(e) => setTargetInput(e.target.value)}
                    placeholder={targetType === "absolute_cents" ? "es. 10,00" : "es. 20"}
                    className="flex-1 min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                    autoFocus
                  />
                  <span className="text-sm text-ink-muted">{targetType === "absolute_cents" ? currentCurrency : "%"}</span>
                </div>
              </div>

              {editing && (
                <div>
                  <div className="text-xs font-mono uppercase tracking-wider text-ink-faint mb-2">Quando scatta</div>
                  <label className="sr-only" htmlFor="quick-alert-fire-mode">Quando scatta</label>
                  <select
                    id="quick-alert-fire-mode"
                    value={fireMode}
                    onChange={(e) => setFireMode(e.target.value as PriceAlertFireMode)}
                    className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                  >
                    <option value="once">Una volta sola</option>
                    <option value="rearm">Ripetibile (con attesa tra un avviso e l&apos;altro)</option>
                  </select>
                  {fireMode === "rearm" && (
                    <div className="mt-2">
                      <label className="block text-xs text-ink-faint mb-1" htmlFor="quick-alert-cooldown">Attesa minima tra due avvisi (ore)</label>
                      <input
                        id="quick-alert-cooldown"
                        type="number"
                        min={1}
                        max={720}
                        value={rearmCooldownHours}
                        onChange={(e) => setRearmCooldownHours(e.target.value)}
                        className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                      />
                    </div>
                  )}
                </div>
              )}

              {error && <p role="alert" className="text-xs text-signal-down">{error}</p>}

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 text-sm px-4 py-2.5 rounded-card border border-base-border bg-base-surface2 text-ink-muted hover:text-ink-primary transition-colors active:scale-95"
                >
                  {editing ? "Annulla" : "Salta, solo desideri"}
                </button>
                <button
                  type="submit"
                  disabled={submitting || !targetInput}
                  className="flex-1 text-sm px-4 py-2.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 transition-colors active:scale-95 disabled:opacity-50 disabled:active:scale-100"
                >
                  {submitting ? "..." : editing ? "Salva" : "Traccia"}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
