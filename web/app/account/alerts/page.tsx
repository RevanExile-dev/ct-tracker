"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { CardRow, fetchCards, fetchConditions, fetchLanguages } from "@/lib/db";
import { formatCents, formatDateLong } from "@/lib/format";
import type { PriceAlert, PriceAlertFireMode, PriceAlertTargetType } from "@/lib/types";
import SiteHeader from "@/components/SiteHeader";

const ANY_OPTION = ""; // select vuoto = "qualunque" (profilo non vincolato su quel campo)

const STATE_LABELS: Record<PriceAlert["state"], string> = {
  armed: "Attivo",
  fired: "Scattato",
  disabled: "Disattivato",
};

const STATE_CLASSES: Record<PriceAlert["state"], string> = {
  armed: "text-signal-up",
  fired: "text-accent-bright",
  disabled: "text-ink-faint",
};

function profileLabel(alert: PriceAlert): string {
  const parts: string[] = [];
  parts.push(alert.language ? `lingua ${alert.language}` : "qualunque lingua");
  parts.push(alert.condition ? `condizione ${alert.condition}` : "qualunque condizione");
  if (alert.canSellViaHub === 1) parts.push("solo CardTrader Zero");
  else if (alert.canSellViaHub === 0) parts.push("mai CardTrader Zero");
  return parts.join(", ");
}

function targetLabel(alert: PriceAlert): string {
  if (alert.targetType === "absolute_cents") {
    return `sotto ${formatCents(alert.targetValue, alert.baselineCurrency ?? "EUR")}`;
  }
  const baseline = alert.baselinePriceCents !== null
    ? ` (rispetto a ${formatCents(alert.baselinePriceCents, alert.baselineCurrency ?? "EUR")})`
    : "";
  return `calo del ${alert.targetValue}%${baseline}`;
}

export default function PriceAlertsPage() {
  const { data: session, status } = useSession();
  const [alerts, setAlerts] = useState<PriceAlert[] | null>(null);
  const [cardsById, setCardsById] = useState<Map<number, CardRow>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [languageOptions, setLanguageOptions] = useState<string[]>([]);
  const [conditionOptions, setConditionOptions] = useState<string[]>([]);

  // --- Ricerca carta per il form "nuovo allarme" (stesso pattern di /lots) ---
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const [searchResults, setSearchResults] = useState<CardRow[]>([]);
  const [selectedCard, setSelectedCard] = useState<CardRow | null>(null);

  useEffect(() => {
    if (!debouncedSearch || selectedCard) return;
    let cancelled = false;
    fetchCards({ search: debouncedSearch, limit: 8 })
      .then((cards) => { if (!cancelled) setSearchResults(cards); })
      .catch(() => { if (!cancelled) setSearchResults([]); });
    return () => { cancelled = true; };
  }, [debouncedSearch, selectedCard]);
  const visibleSearchResults = !debouncedSearch || selectedCard ? [] : searchResults;

  // --- Resto del form ---
  const [language, setLanguage] = useState(ANY_OPTION);
  const [condition, setCondition] = useState(ANY_OPTION);
  const [canSellViaHub, setCanSellViaHub] = useState<"any" | "only" | "never">("any");
  const [targetType, setTargetType] = useState<PriceAlertTargetType>("absolute_cents");
  const [targetInput, setTargetInput] = useState("");
  const [fireMode, setFireMode] = useState<PriceAlertFireMode>("once");
  const [rearmCooldownHours, setRearmCooldownHours] = useState("24");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function resetForm() {
    setSearch(""); setSelectedCard(null); setLanguage(ANY_OPTION); setCondition(ANY_OPTION);
    setCanSellViaHub("any"); setTargetType("absolute_cents"); setTargetInput("");
    setFireMode("once"); setRearmCooldownHours("24");
  }

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetch("/api/account/alerts")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Allarmi non disponibili (${res.status}).`);
        return res.json();
      })
      .then((data: PriceAlert[]) => { if (!cancelled) setAlerts(data); })
      .catch(() => { if (!cancelled) setError("Non riesco a caricare gli allarmi. Riprova tra poco."); });
    return () => { cancelled = true; };
  }, [session]);

  useEffect(() => {
    let cancelled = false;
    const ids = [...new Set((alerts ?? []).map((a) => a.blueprintId))];
    fetchCards({ ids })
      .then((cards) => { if (!cancelled) setCardsById(new Map(cards.map((c) => [c.id, c]))); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [alerts]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchLanguages(), fetchConditions()])
      .then(([langs, conds]) => { if (!cancelled) { setLanguageOptions(langs); setConditionOptions(conds); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  async function submitAlert(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    if (!selectedCard) { setFormError("Seleziona prima una carta dalla ricerca."); return; }

    let targetValue: number;
    if (targetType === "absolute_cents") {
      const parsed = Number(targetInput.replace(",", "."));
      if (!Number.isFinite(parsed) || parsed <= 0) { setFormError("Prezzo soglia non valido."); return; }
      targetValue = Math.round(parsed * 100);
    } else {
      const parsed = Number(targetInput);
      if (!Number.isInteger(parsed) || parsed <= 0 || parsed >= 100) { setFormError("Percentuale di calo non valida (1-99)."); return; }
      targetValue = parsed;
    }

    let rearmHours: number | undefined;
    if (fireMode === "rearm") {
      const parsed = Number(rearmCooldownHours);
      if (!Number.isInteger(parsed) || parsed < 1) { setFormError("Ore di attesa (cooldown) non valide."); return; }
      rearmHours = parsed;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/account/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blueprintId: selectedCard.id,
          language: language || null,
          condition: condition || null,
          canSellViaHub: canSellViaHub === "any" ? null : canSellViaHub === "only" ? 1 : 0,
          targetType,
          targetValue,
          fireMode,
          rearmCooldownHours: rearmHours,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Richiesta fallita (${res.status})`);
      }
      const created: PriceAlert = await res.json();
      setAlerts((current) => [created, ...(current ?? [])]);
      resetForm();
    } catch (err) {
      setFormError(String((err as Error)?.message ?? err));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleAlert(alert: PriceAlert) {
    const enable = alert.state !== "armed";
    const previous = alerts;
    setAlerts((current) => current?.map((a) => (a.id === alert.id ? { ...a, state: enable ? "armed" : "disabled" } : a)) ?? current);
    try {
      const res = await fetch(`/api/account/alerts/${alert.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: enable }),
      });
      if (!res.ok) throw new Error();
      const updated: PriceAlert = await res.json();
      setAlerts((current) => current?.map((a) => (a.id === updated.id ? updated : a)) ?? current);
    } catch {
      setAlerts(previous ?? null);
      setError("Non sono riuscito ad aggiornare l'allarme. Riprova.");
    }
  }

  async function removeAlert(id: number) {
    const previous = alerts;
    setAlerts((current) => current?.filter((a) => a.id !== id) ?? current);
    try {
      const res = await fetch(`/api/account/alerts/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
    } catch {
      setAlerts(previous ?? null);
      setError("Non sono riuscito a eliminare l'allarme. Riprova.");
    }
  }

  if (status === "loading") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 sm:px-8 py-8 sm:py-10">
        <SiteHeader compact />
        <div className="py-20 text-center text-sm font-mono text-ink-muted animate-pulse">Carico…</div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 sm:px-8 py-8 sm:py-10">
        <SiteHeader compact />
        <div className="rounded-card border border-base-border bg-base-surface/60 py-20 px-5 text-center text-ink-muted">
          <p className="mb-4">Gli allarmi prezzo sono legati al tuo account: accedi per crearli.</p>
          <Link href="/login" className="btn-lift inline-flex text-sm px-4 py-2.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60">Accedi</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 sm:px-8 py-8 sm:py-10">
      <SiteHeader compact />
      <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink-primary mb-1">Allarmi prezzo</h1>
      <p className="text-ink-muted mb-6">
        Ricevi un avviso quando il prezzo di una carta, in un profilo esatto (lingua/condizione/CardTrader Zero), scende sotto una soglia o cala di una percentuale rispetto al prezzo di oggi. L&apos;invio effettivo delle notifiche (Telegram) arriva con un passo successivo — qui puoi già creare e gestire gli allarmi.
      </p>

      {error && <p role="alert" className="mb-4 text-sm text-signal-down">{error}</p>}

      <form onSubmit={submitAlert} className="mb-8 rounded-card border border-base-border bg-base-surface/70 px-5 py-5">
        <h2 className="font-display text-lg font-bold text-ink-primary mb-4">Nuovo allarme</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2 relative">
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-faint mb-1.5" htmlFor="alert-search">Carta</label>
            {selectedCard ? (
              <div className="flex items-center justify-between rounded-lg border border-base-border bg-base-surface2 px-3 py-2.5">
                <span className="text-sm text-ink-primary">{selectedCard.name} <span className="text-ink-faint">— {selectedCard.expansion_name}</span></span>
                <button type="button" onClick={() => { setSelectedCard(null); setSearch(""); }} className="text-xs text-ink-muted hover:text-signal-down min-h-8 px-2">Cambia</button>
              </div>
            ) : (
              <>
                <input
                  id="alert-search"
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cerca una carta per nome…"
                  className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                />
                {visibleSearchResults.length > 0 && (
                  <ul className="absolute z-10 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-base-border bg-base-surface shadow-card">
                    {visibleSearchResults.map((card) => (
                      <li key={card.id}>
                        <button
                          type="button"
                          onClick={() => { setSelectedCard(card); setSearchResults([]); }}
                          className="w-full text-left px-3 py-2.5 text-sm hover:bg-base-surface2 transition-colors"
                        >
                          {card.name} <span className="text-ink-faint">— {card.expansion_name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-faint mb-1.5" htmlFor="alert-language">Lingua</label>
            <select id="alert-language" value={language} onChange={(e) => setLanguage(e.target.value)}
              className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
              <option value={ANY_OPTION}>Qualunque lingua</option>
              {languageOptions.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-faint mb-1.5" htmlFor="alert-condition">Condizione</label>
            <select id="alert-condition" value={condition} onChange={(e) => setCondition(e.target.value)}
              className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
              <option value={ANY_OPTION}>Qualunque condizione</option>
              {conditionOptions.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-faint mb-1.5" htmlFor="alert-hub">CardTrader Zero</label>
            <select id="alert-hub" value={canSellViaHub} onChange={(e) => setCanSellViaHub(e.target.value as typeof canSellViaHub)}
              className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
              <option value="any">Indifferente</option>
              <option value="only">Solo CardTrader Zero</option>
              <option value="never">Mai CardTrader Zero</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-faint mb-1.5" htmlFor="alert-target-type">Tipo di soglia</label>
            <select id="alert-target-type" value={targetType} onChange={(e) => { setTargetType(e.target.value as PriceAlertTargetType); setTargetInput(""); }}
              className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
              <option value="absolute_cents">Prezzo assoluto</option>
              <option value="percent_drop">Calo percentuale (dal prezzo di oggi)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-faint mb-1.5" htmlFor="alert-target-value">
              {targetType === "absolute_cents" ? "Avvisami sotto (€)" : "Calo percentuale (%)"}
            </label>
            <input id="alert-target-value" type="text" inputMode="decimal" value={targetInput} onChange={(e) => setTargetInput(e.target.value)}
              placeholder={targetType === "absolute_cents" ? "es. 12.50" : "es. 15"}
              className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70" />
          </div>

          <div>
            <label className="block text-xs font-mono uppercase tracking-wider text-ink-faint mb-1.5" htmlFor="alert-fire-mode">Quando scatta</label>
            <select id="alert-fire-mode" value={fireMode} onChange={(e) => setFireMode(e.target.value as PriceAlertFireMode)}
              className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70">
              <option value="once">Una volta sola</option>
              <option value="rearm">Ripetibile (con attesa tra un avviso e l&apos;altro)</option>
            </select>
          </div>

          {fireMode === "rearm" && (
            <div>
              <label className="block text-xs font-mono uppercase tracking-wider text-ink-faint mb-1.5" htmlFor="alert-cooldown">Attesa minima tra due avvisi (ore)</label>
              <input id="alert-cooldown" type="number" min={1} max={720} value={rearmCooldownHours}
                onChange={(e) => setRearmCooldownHours(e.target.value)}
                className="w-full min-h-11 rounded-lg border border-base-border bg-base-surface2 px-3 text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70" />
            </div>
          )}
        </div>

        {formError && <p role="alert" className="mt-3 text-sm text-signal-down">{formError}</p>}

        <button type="submit" disabled={submitting}
          className="btn-lift mt-4 text-sm px-4 py-2.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 transition-colors disabled:opacity-50">
          {submitting ? "Creo…" : "Crea allarme"}
        </button>
      </form>

      {alerts === null ? (
        <div className="py-10 text-center text-sm font-mono text-ink-muted animate-pulse">Carico…</div>
      ) : alerts.length === 0 ? (
        <p className="text-ink-faint text-sm">Nessun allarme creato finora.</p>
      ) : (
        <ul className="space-y-3">
          {alerts.map((alert) => {
            const card = cardsById.get(alert.blueprintId);
            return (
              <li key={alert.id} className="rounded-card border border-base-border bg-base-surface/70 px-5 py-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="text-ink-primary font-medium">
                      {card ? <>{card.name} <span className="text-ink-faint">— {card.expansion_name}</span></> : `Carta #${alert.blueprintId}`}
                    </div>
                    <div className="text-sm text-ink-muted mt-0.5">{profileLabel(alert)}</div>
                    <div className="text-sm text-ink-muted">{targetLabel(alert)}</div>
                    <div className="text-xs font-mono text-ink-faint mt-1">
                      {alert.fireMode === "once" ? "Una volta sola" : `Ripetibile ogni ${alert.rearmCooldownHours}h`}
                      {" · "}creato il {formatDateLong(alert.createdAt)}
                      {alert.firedAt && <> · scattato il {formatDateLong(alert.firedAt)}</>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-xs font-mono uppercase tracking-wider ${STATE_CLASSES[alert.state]}`}>{STATE_LABELS[alert.state]}</span>
                    <button type="button" onClick={() => toggleAlert(alert)}
                      className="text-xs text-ink-muted hover:text-accent-bright min-h-8 px-2 border border-base-border rounded-lg">
                      {alert.state === "armed" ? "Disattiva" : "Attiva"}
                    </button>
                    <button type="button" onClick={() => removeAlert(alert.id)}
                      className="text-xs text-ink-muted hover:text-signal-down min-h-8 px-2 border border-base-border rounded-lg">
                      Elimina
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
