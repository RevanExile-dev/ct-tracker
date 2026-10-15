// "Perché non è ancora scattato?" - riga di stato per un allarme prezzo, in
// una frase: prezzo di adesso (sullo stesso profilo dell'allarme), soglia e
// quanto manca. Pura (nessun import) per poterla provare con node --test.
// La soglia e il confronto replicano _alert_target_met in scripts/db.py.

export type AlertStatusInput = {
  state: "armed" | "fired" | "disabled";
  targetType: "absolute_cents" | "percent_drop";
  targetValue: number;
  baselinePriceCents: number | null;
  baselineCurrency: string | null;
  fireMode: "once" | "rearm";
  rearmCooldownHours: number | null;
  // undefined = il server non l'ha calcolato (risposta di POST/PATCH);
  // null = nessuna offerta attuale con questo profilo.
  matchingPriceCents?: number | null;
  matchingPriceCurrency?: string | null;
};

export type AlertStatus = { text: string; tone: "ok" | "wait" | "muted" };

export function alertThresholdCents(a: Pick<AlertStatusInput, "targetType" | "targetValue" | "baselinePriceCents">): number | null {
  if (a.targetType === "absolute_cents") return a.targetValue;
  if (a.baselinePriceCents === null) return null;
  return Math.floor((a.baselinePriceCents * (100 - a.targetValue)) / 100);
}

export function alertStatus(a: AlertStatusInput, fmt: (cents: number, currency: string) => string): AlertStatus | null {
  if (a.state === "disabled") {
    return { text: "Disattivato: non lo controlliamo finché non lo attivi.", tone: "muted" };
  }
  if (a.matchingPriceCents === undefined) return null;
  const currency = a.matchingPriceCurrency ?? a.baselineCurrency ?? "EUR";
  const threshold = alertThresholdCents(a);
  const thresholdTxt = threshold !== null ? fmt(threshold, currency) : null;

  if (a.matchingPriceCents === null) {
    return {
      text: a.state === "fired"
        ? "Scattato. Ora non c'è nessuna offerta con questo profilo."
        : "Nessuna offerta con questo profilo adesso: finché non ce n'è una non può scattare.",
      tone: "muted",
    };
  }

  const nowTxt = fmt(a.matchingPriceCents, currency);
  const met = threshold !== null && a.matchingPriceCents <= threshold;

  if (a.state === "fired") {
    const after = a.fireMode === "rearm"
      ? `Torna attivo da solo dopo ${a.rearmCooldownHours ?? 24} h dallo scatto.`
      : "Non ti avvisa più finché non lo riattivi.";
    return { text: `Soglia raggiunta${thresholdTxt ? ` (${thresholdTxt})` : ""}. Ora ${nowTxt}. ${after}`, tone: "ok" };
  }
  if (threshold === null) return { text: `Ora ${nowTxt}.`, tone: "wait" };
  if (met) {
    return { text: `Ora ${nowTxt}: già sotto la soglia di ${thresholdTxt}. Scatta al prossimo controllo dei prezzi.`, tone: "ok" };
  }
  const missing = a.matchingPriceCents - threshold;
  const pct = Math.round((missing / a.matchingPriceCents) * 100);
  return { text: `Ora ${nowTxt}, soglia ${thresholdTxt}: mancano ${fmt(missing, currency)} (−${pct}%).`, tone: "wait" };
}
