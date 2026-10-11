"use client";

import { useEffect, useState } from "react";
import { fetchCardmarketReference } from "@/lib/db";
import {
  visibleCardmarketReference, referenceValueCents,
  type CardmarketPrices, type CardmarketReference,
} from "@/lib/cardmarket";
import {
  estimateShipping, bundleExample, zeroHubShipping,
  CARDMARKET_SHIPPING_CHECKED_AT, CARDMARKET_SHIPPING_SOURCE_URL,
  ZERO_HUB_CHECKED_AT, ZERO_HUB_SOURCE_URL,
} from "@/lib/cardmarketShipping";
import { formatCents, formatDate, formatNumber } from "@/lib/format";

// Riquadro "Riferimento Cardmarket" della scheda carta. Volutamente DIVERSO
// dalle offerte CardTrader: bordo tratteggiato, nessun colore d'accento,
// nessun pulsante d'acquisto, nessuna etichetta "miglior prezzo". Sono medie
// per carta (tutte le lingue e condizioni), non inserzioni reali. Mai nella
// griglia, nei filtri, nell'ordinamento, nello storico, negli allarmi o nel
// valore del Binder. Niente da mostrare (caricamento, errore, nessun dato,
// dato piu' vecchio di 3 giorni) = il riquadro non compare.

type Loaded = { id: number; ref: CardmarketReference | null };

function PriceRows({ prices }: { prices: CardmarketPrices }) {
  const rows: Array<[string, number | null]> = [
    ["Tendenza", prices.trend_cents],
    ["Più basso", prices.low_cents],
    ["Media 7 giorni", prices.avg7_cents],
    ["Media 30 giorni", prices.avg30_cents],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
      {rows.filter(([, v]) => typeof v === "number" && v > 0).map(([label, v]) => (
        <div key={label} className="contents">
          <dt className="text-ink-muted">{label}</dt>
          <dd className="font-mono text-ink-primary text-right">{formatCents(v, "EUR")}</dd>
        </div>
      ))}
    </dl>
  );
}

function ShippingNote({ valueCents }: { valueCents: number }) {
  const est = estimateShipping(valueCents, 1);
  if (!est) return null;
  const bundle = bundleExample();
  const zero = zeroHubShipping(1);
  const over25 = valueCents > 2_500;
  return (
    <div className="mt-3 pt-3 border-t border-dashed border-base-border text-xs text-ink-muted space-y-1" data-testid="cardmarket-shipping">
      <p>
        <span className="font-medium text-ink-primary">Spedizione stimata</span>{" "}
        <span className="font-mono uppercase tracking-wider text-[10px] px-1.5 py-0.5 rounded-full border border-base-border">stima</span>
      </p>
      <p>
        {over25 ? (
          <>
            Da un venditore italiano ({est.method}):{" "}
            <span className="font-mono text-ink-primary">da {formatCents(est.italyCents, "EUR")}</span>
            {est.abroadMaxCents !== null
              ? <> · da un venditore estero fino a circa <span className="font-mono text-ink-primary">{formatNumber(Math.round(est.abroadMaxCents / 100))} €</span></>
              : <> · più cara da un venditore estero</>}
            . Sopra i 25 € la raccomandata è obbligatoria.
          </>
        ) : (
          <>
            Da un venditore italiano ({est.method}, fino a 4 carte):{" "}
            <span className="font-mono text-ink-primary">+{formatCents(est.italyCents, "EUR")}</span>{" "}
            per ordine, non per carta.
          </>
        )}
      </p>
      <p>
        Più carte dallo stesso venditore dividono la stessa spedizione (esempio: {bundle.cards} carte in
        una busta, {formatCents(bundle.totalCents, "EUR")}, circa {formatCents(bundle.perCardCents, "EUR")} a carta).
      </p>
      {zero && (
        <p data-testid="zero-comparison">
          Per confronto, con CardTrader Zero la spedizione è una sola per tutto l&apos;ordine, anche se compri da più
          venditori: <span className="font-mono text-ink-primary">{formatCents(zero.cents, "EUR")}</span> fino a circa{" "}
          {zero.maxCards} carte (stima). Conviene soprattutto quando le carte vengono da molti venditori diversi.
        </p>
      )}
      <p className="text-ink-faint">
        Tariffe controllate il {formatDate(CARDMARKET_SHIPPING_CHECKED_AT)} su{" "}
        <a href={CARDMARKET_SHIPPING_SOURCE_URL} target="_blank" rel="noreferrer" className="underline">Cardmarket</a>
        {" "}e l&apos;{formatDate(ZERO_HUB_CHECKED_AT)} su{" "}
        <a href={ZERO_HUB_SOURCE_URL} target="_blank" rel="noreferrer" className="underline">CardTrader Zero</a>.
      </p>
    </div>
  );
}

export default function CardmarketReferenceBox({ blueprintId }: { blueprintId: number }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCardmarketReference(blueprintId)
      .then((ref) => { if (!cancelled) setLoaded({ id: blueprintId, ref }); })
      // Errore = nessun riquadro: e' un'informazione accessoria.
      .catch(() => { if (!cancelled) setLoaded({ id: blueprintId, ref: null }); });
    return () => { cancelled = true; };
  }, [blueprintId]);

  // Il componente non si rimonta passando da una carta all'altra: i dati
  // di un'altra carta non devono mai restare in vista.
  const ref = loaded && loaded.id === blueprintId ? visibleCardmarketReference(loaded.ref) : null;
  if (!ref) return null;
  const value = referenceValueCents(ref);

  return (
    <section
      className="mt-8 rounded-card border border-dashed border-base-border bg-base-surface2/40 p-4"
      aria-labelledby="cardmarket-ref-title"
      data-testid="cardmarket-reference"
    >
      <h2 id="cardmarket-ref-title" className="font-display font-medium text-ink-primary">
        Riferimento Cardmarket{" "}
        <span className="text-ink-muted font-normal text-sm">· media di mercato, non un&apos;offerta</span>
      </h2>
      <p className="text-xs text-ink-muted mt-0.5 mb-3">
        Prezzi in euro validi per la carta in generale, di tutte le lingue e condizioni. Le offerte reali,
        con venditore e condizione, sono quelle di CardTrader.
      </p>
      {ref.base && <PriceRows prices={ref.base} />}
      {ref.holo && (
        <div className={ref.base ? "mt-3 pt-3 border-t border-dashed border-base-border" : ""}>
          <div className="text-xs font-mono uppercase tracking-wider text-ink-faint mb-1">Versione holo</div>
          <PriceRows prices={ref.holo} />
        </div>
      )}
      {value !== null && <ShippingNote valueCents={value} />}
      <p className="text-[11px] text-ink-faint mt-3" data-testid="cardmarket-source">
        Fonte: Cardmarket via TCGdex · aggiornato il {formatDate(ref.updated_at)}
      </p>
    </section>
  );
}
