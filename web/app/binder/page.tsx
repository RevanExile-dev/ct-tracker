"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { CardRow, fetchCards, fetchCardsTrend, fetchOwnedLanguagePrices } from "@/lib/db";
import { BinderEntry, getBinderEntries, setBinderQuantity, toggleBinder } from "@/lib/binder";
import { formatCents } from "@/lib/format";
import { useScrollRestoration } from "@/lib/useScrollRestoration";
import type { BinderValuePoint, Lot } from "@/lib/types";
import { primaryLotFor, summarizeLotEconomics } from "@/lib/lotSummary";
import BinderBook from "@/components/BinderBook";
import BinderTable from "@/components/BinderTable";
import CardTile from "@/components/CardTile";
import CollectionValueChart from "@/components/CollectionValueChart";
import LogPurchaseModal from "@/components/LogPurchaseModal";
import SiteHeader from "@/components/SiteHeader";

function BinderContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") === "book" ? "book" : "collection";
  const layout = searchParams.get("layout") === "table" ? "table" : "grid";
  const initialPage = Math.max(0, Number(searchParams.get("page")) || 0);
  const [cards, setCards] = useState<CardRow[] | null>(null);
  // Lazy initializer (non un effetto): getBinderEntries() e' gia' sicura in
  // SSR (torna [] se window e' undefined, vedi web/lib/binder.ts), quindi
  // puo' girare direttamente durante il render invece di passare da un
  // useEffect + setState separato (che triggererebbe un render a cascata
  // in piu' senza motivo).
  const [entries, setEntries] = useState<BinderEntry[]>(() => getBinderEntries());
  const [error, setError] = useState<string | null>(null);
  const { data: session } = useSession();
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const historyKey = `${session?.user?.email ?? "anonymous"}:${historyAttempt}`;
  const [historyResponse, setHistoryResponse] = useState<{
    key: string; points: BinderValuePoint[] | null; error: string | null;
  } | null>(null);
  const valueHistory = historyResponse?.key === historyKey ? historyResponse.points : null;
  const historyError = historyResponse?.key === historyKey ? historyResponse.error : null;
  const [trends, setTrends] = useState<Record<number, { avgCents: number; days: number }>>({});
  // Lotti (costo/provenienza dichiarati) di questo utente - solo-account,
  // vedi web/lib/types.ts su Lot - usati sia per il riquadro di plusvalenza
  // sotto "Valore stimato" sia dal pulsante "Dettagli acquisto" su ogni
  // carta (apre LogPurchaseModal precompilato con l'ultimo lotto noto).
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [lotsReloadTick, setLotsReloadTick] = useState(0);
  const [purchaseModalCard, setPurchaseModalCard] = useState<CardRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Filtro SQL sugli ID salvati invece di scaricare l'intero catalogo per
    // poi tenerne solo una manciata in JS - stesso pattern del problema
    // principale trovato nell'audit (fetchCards senza limite sulla home),
    // qui evitabile del tutto perche' gli ID voluti sono gia' noti. Legge
    // "entries" dallo stato (gia' popolato dal lazy initializer sopra) solo
    // per l'elenco iniziale di ID: un cambio di quantita'/rimozione
    // successivo aggiorna "entries" ma non deve rifare il fetch (i prezzi
    // non dipendono dalla quantita' posseduta), quindi resta [] come deps,
    // non [entries].
    fetchCards({ ids: entries.map((entry) => entry.blueprintId) })
      .then((cards) => { if (!cancelled) setCards(cards); })
      .catch((reason) => { if (!cancelled) setError(String(reason?.message ?? reason)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // blueprintId -> quantita' posseduta: usata sia per "Valore stimato" sotto
  // sia per il badge/stepper mostrato su ogni carta (CardTile/BinderTable).
  const quantityById = useMemo(
    () => new Map(entries.map((entry) => [entry.blueprintId, entry.quantity])),
    [entries]
  );

  function changeQuantity(id: number, quantity: number) {
    setEntries(setBinderQuantity(id, quantity));
  }

  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.blueprintId, entry])), [entries]);

  // Solo le entry con una lingua nota vale la pena interrogare - "condition"
  // non ha oggi nessun punto del codice che la imposti (verificato: scanner
  // e stella nel catalogo non la toccano mai), quindi per ora la stima resta
  // sulla sola lingua, non su un "profilo" completo (vedi commento su
  // fetchOwnedLanguagePrices in web/lib/db.server.ts).
  const languageEntries = useMemo(
    () => entries.filter((entry): entry is BinderEntry & { language: string } => !!entry.language)
      .map((entry) => ({ id: entry.blueprintId, language: entry.language })),
    [entries]
  );
  // Chiave stabile per l'effetto sotto: cambia SOLO se cambia quali carte
  // hanno una lingua nota o quale lingua e' registrata, non ad ogni render
  // (languageEntries e' un nuovo array ad ogni chiamata di useMemo anche a
  // contenuto invariato, ma qui serve solo il contenuto).
  const languageEntriesKey = languageEntries.map((e) => `${e.id}:${e.language}`).sort().join(",");
  // Chiave "blueprintId:lingua" (non solo blueprintId): vedi il commento su
  // fetchOwnedLanguagePrices in web/lib/db.server.ts - qui nel binder ogni
  // carta ha una sola lingua nota quindi non cambierebbe nulla in pratica,
  // ma la forma del risultato e' condivisa con web/app/lots/page.tsx (dove
  // invece serve davvero) e deve restare coerente in entrambi i punti.
  const [languagePrices, setLanguagePrices] = useState<
    Record<string, { price_cents: number; price_currency: string | null; listings_count: number }>
  >({});

  useEffect(() => {
    // fetchOwnedLanguagePrices torna {} subito su un array vuoto (vedi
    // web/lib/db.ts), senza fare rete - nessun bisogno di un ramo sincrono
    // separato qui dentro (che l'effetto sarebbe stato scoraggiato dal
    // fare: setState nel corpo dell'effetto, non in una callback asincrona).
    let cancelled = false;
    fetchOwnedLanguagePrices(languageEntries)
      .then((result) => { if (!cancelled) setLanguagePrices(result); })
      // Best-effort, come fetchCardsTrend: senza risposta le carte con
      // lingua nota restano semplicemente sul "best" generale (nessuna
      // regressione, e' lo stesso comportamento di prima di questo fix).
      .catch(() => { if (!cancelled) setLanguagePrices({}); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [languageEntriesKey]);

  // Prezzo risolto per carta: nella lingua posseduta quando nota E disponibile
  // sul mercato, altrimenti il "best" generale - mai un fallback silenzioso
  // quando una lingua ERA nota ma non ha trovato corrispondenza (matchedLanguage
  // null ma triedLanguage valorizzato: la UI lo segnala esplicitamente).
  const priceInfoById = useMemo(() => {
    const map = new Map<number, {
      cents: number | null; currency: string | null;
      matchedLanguage: string | null; triedLanguage: string | null;
    }>();
    for (const card of cards ?? []) {
      const bestCents = card.best_price_cents ?? card.latest_price_cents;
      const bestCurrency = card.best_price_currency ?? card.latest_price_currency;
      const ownedLanguage = entryById.get(card.id)?.language ?? null;
      const languagePrice = ownedLanguage ? languagePrices[`${card.id}:${ownedLanguage}`] : undefined;
      map.set(card.id, languagePrice
        ? { cents: languagePrice.price_cents, currency: languagePrice.price_currency, matchedLanguage: ownedLanguage, triedLanguage: ownedLanguage }
        : { cents: bestCents, currency: bestCurrency, matchedLanguage: null, triedLanguage: ownedLanguage });
    }
    return map;
  }, [cards, entryById, languagePrices]);

  // Forma passata a CardTile/BinderTable per il badge/fallback esplicito -
  // derivata da priceInfoById, non ricalcolata: stessa fonte di verita' di
  // "summary" sopra, cosi' il totale e i singoli prezzi mostrati non possono
  // divergere.
  const ownedLanguageMatchById = useMemo(() => {
    const map = new Map<number, { language: string; cents: number | null; currency: string | null }>();
    for (const [id, info] of priceInfoById) {
      if (!info.triedLanguage) continue;
      map.set(id, {
        language: info.triedLanguage,
        cents: info.matchedLanguage ? info.cents : null,
        currency: info.matchedLanguage ? info.currency : null,
      });
    }
    return map;
  }, [priceInfoById]);

  useEffect(() => {
    // Batch su tutte le carte del binder in una sola richiesta (vedi
    // fetchCardsTrend) invece di uno storico per carta - dato pubblico di
    // catalogo, nessun bisogno di login (a differenza di valueHistory
    // sotto). Solo per la vista tabella (BinderTable), ma calcolato appena
    // le carte sono pronte per non ritardare il cambio di layout.
    if (!cards || cards.length === 0) return;
    let cancelled = false;
    fetchCardsTrend(cards.map((c) => c.id))
      .then((result) => { if (!cancelled) setTrends(result); })
      .catch(() => { /* best-effort: la tabella cade sul "—" per riga */ });
    return () => { cancelled = true; };
  }, [cards]);

  useEffect(() => {
    // Lo storico del valore esiste solo lato server (binder_value_snapshots,
    // scritto dal sync giornaliero): senza login non c'e' niente da
    // mostrare, niente fetch verso un endpoint che risponderebbe 401 (il
    // rendering sotto e' gia' condizionato su `session`, quindi non serve
    // nemmeno resettare lo stato qui al logout).
    if (!session) return;
    let cancelled = false;
    fetch("/api/account/binder/value-history")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Storico non disponibile (${res.status}).`);
        const body: unknown = await res.json();
        if (!Array.isArray(body)) throw new Error("Risposta dello storico non valida.");
        return body;
      })
      .then((points: BinderValuePoint[]) => { if (!cancelled) setHistoryResponse({ key: historyKey, points, error: null }); })
      .catch(() => { if (!cancelled) setHistoryResponse({ key: historyKey, points: null, error: "Non riesco a caricare lo storico. Riprova tra poco." }); });
    return () => { cancelled = true; };
  }, [session, historyKey]);

  useEffect(() => {
    // Stesso motivo di valueHistory sopra: i lotti sono solo-account (vedi
    // web/lib/types.ts), nessuna fetch da sloggati - non serve nemmeno
    // resettare lo stato qui al logout, il rendering del riquadro
    // plusvalenza sotto e' gia' condizionato su `session`.
    if (!session) return;
    let cancelled = false;
    fetch("/api/account/lots")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: Lot[]) => { if (!cancelled) setLots(data); })
      // Best-effort come trends sopra: senza risposta il binder mostra
      // solo "Valore stimato" (comportamento gia' esistente prima di
      // questa funzionalita'), nessun riquadro di plusvalenza in piu'.
      .catch(() => { if (!cancelled) setLots(null); });
    return () => { cancelled = true; };
  }, [session, lotsReloadTick]);

  const summary = useMemo(() => {
    if (!cards) return null;
    const priced = cards.filter((card) => priceInfoById.get(card.id)?.cents !== null);
    // Stessa euristica di snapshot_binder_values() in scripts/db.py (che
    // scrive lo storico mostrato sopra): moltiplica per la quantita'
    // posseduta, non piu' una copia per tipo (bug corretto qui - 3 copie da
    // 10 euro risultavano 10, non 30). "totalCopies"/"pricedCopies" sono la
    // somma delle quantita', diversi da cards.length ("tipi di carta").
    // "total" usa priceInfoById (prezzo nella lingua posseduta quando nota e
    // disponibile, altrimenti il "best" generale, mai i due mischiati per la
    // stessa carta) invece del solo best_price_cents.
    const languageAttempted = cards.filter((card) => priceInfoById.get(card.id)?.triedLanguage).length;
    const languageMatched = cards.filter((card) => priceInfoById.get(card.id)?.matchedLanguage).length;
    return {
      total: priced.reduce((sum, card) => sum + (priceInfoById.get(card.id)?.cents ?? 0) * (quantityById.get(card.id) ?? 1), 0),
      priced: priced.length,
      totalCopies: cards.reduce((sum, card) => sum + (quantityById.get(card.id) ?? 1), 0),
      // Dalla stessa fonte (priceInfoById) usata per "total" qui sopra, non
      // di nuovo da best_price_currency: quella potrebbe differire dalla
      // valuta EFFETTIVAMENTE usata per questa carta se il prezzo mostrato
      // viene invece dalla lingua posseduta (languagePrices).
      currency: (priced[0] && priceInfoById.get(priced[0].id)?.currency) ?? "EUR",
      languageAttempted,
      languageMatched,
    };
  }, [cards, quantityById, priceInfoById]);

  // Plusvalenza non realizzata sui soli lotti con costo dichiarato - stessa
  // funzione usata da web/app/lots/page.tsx (web/lib/lotSummary.ts), qui sul
  // sottoinsieme di lotti le cui carte sono nel binder attualmente caricato
  // (cardsById): un lotto di una carta rimossa dal binder ma non ancora
  // eliminata da /lotti non avrebbe comunque un prezzo da mostrare qui - va
  // quindi FILTRATO fuori dalla somma (rilievo review, verificato reale:
  // senza questo filter il suo costo entrerebbe comunque in costCents pur
  // non avendo un valueCents corrispondente, sottostimando la plusvalenza).
  const cardsByIdForLots = useMemo(() => new Map((cards ?? []).map((c) => [c.id, c])), [cards]);
  const lotsInBinder = useMemo(
    () => (lots ?? []).filter((lot) => cardsByIdForLots.has(lot.blueprintId)),
    [lots, cardsByIdForLots]
  );
  const lotEconomics = useMemo(
    () => (lots ? summarizeLotEconomics(lotsInBinder, cardsByIdForLots, languagePrices) : null),
    [lots, lotsInBinder, cardsByIdForLots, languagePrices]
  );

  function handlePurchaseSaved() {
    setPurchaseModalCard(null);
    setLotsReloadTick((t) => t + 1);
  }

  const cardsWithPurchaseInfo = useMemo(
    () => new Set((lots ?? []).map((lot) => lot.blueprintId)),
    [lots]
  );

  const setBookPage = useCallback((page: number) => {
    const params = new URLSearchParams(window.location.search);
    params.set("view", "book");
    if (page > 0) params.set("page", String(page)); else params.delete("page");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router]);

  const query = searchParams.toString();
  const returnTo = query ? `${pathname}?${query}` : pathname;
  useScrollRestoration("binder", cards !== null || error !== null, returnTo);

  function removeFromBinder(id: number) {
    toggleBinder(id);
    setCards((current) => current?.filter((card) => card.id !== id) ?? current);
    setEntries((current) => current.filter((entry) => entry.blueprintId !== id));
  }

  return (
    <main className="binder-shell mx-auto w-full max-w-[1600px] px-4 sm:px-8 py-8 sm:py-10">
      <SiteHeader compact />
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-5 mb-6">
        <div>
          <Link href="/" className="text-sm text-ink-muted hover:text-accent-bright transition-colors inline-flex items-center gap-1.5 mb-4">← Catalogo</Link>
          <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink-primary">Il mio Binder</h1>
          <p className="text-ink-muted mt-1">La stessa collezione, da consultare o da sfogliare come un album.</p>
        </div>
        <nav className="binder-view-switch inline-flex self-start rounded-xl border border-base-border bg-base-surface p-1" aria-label="Modalita' Binder">
          <Link href="/binder?view=collection" aria-current={view === "collection" ? "page" : undefined} className={`min-h-11 inline-flex items-center rounded-lg px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${view === "collection" ? "bg-accent/15 text-accent-bright shadow-sm" : "text-ink-muted hover:text-ink-primary"}`}>▦ Collezione</Link>
          <Link href="/binder?view=book" aria-current={view === "book" ? "page" : undefined} className={`min-h-11 inline-flex items-center rounded-lg px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 ${view === "book" ? "bg-accent/15 text-accent-bright shadow-sm" : "text-ink-muted hover:text-ink-primary"}`}>◫ Sfoglia Binder</Link>
        </nav>
      </div>

      {summary && cards && cards.length > 0 && (
        <div className="mb-7 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-card border border-base-border bg-base-surface/70 px-5 py-4">
          <div>
            <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Carte</div>
            <div className="font-display text-xl font-bold">
              {cards.length}
              {summary.totalCopies !== cards.length && (
                <span className="text-sm font-normal text-ink-faint ml-1.5">({summary.totalCopies} copie)</span>
              )}
            </div>
          </div>
          <div><div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Valore stimato</div><div className="font-display text-xl font-bold text-accent-bright">{formatCents(summary.total, summary.currency)}</div></div>
          {summary.priced < cards.length && <span className="text-xs text-ink-faint">{summary.priced}/{cards.length} con prezzo</span>}
          {summary.languageAttempted > 0 && (
            <span className="text-xs text-ink-faint">{summary.languageMatched}/{summary.languageAttempted} nella lingua posseduta</span>
          )}
          {session && lotEconomics && lotEconomics.costKnownCount > 0 && (
            <>
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Speso (prezzo di acquisto)</div>
                <div className="font-display text-xl font-bold">{formatCents(lotEconomics.costCents)}</div>
              </div>
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Plusvalenza non realizzata</div>
                <div className={`font-display text-xl font-bold ${lotEconomics.gainCents >= 0 ? "text-signal-up" : "text-signal-down"}`}>
                  {lotEconomics.gainCount > 0 ? formatCents(lotEconomics.gainCents) : "—"}
                </div>
              </div>
              <Link href="/lots" className="text-xs text-ink-muted hover:text-accent-bright transition-colors underline">Dettaglio lotti →</Link>
            </>
          )}
          {view === "collection" && (
            <div className="ml-auto inline-flex rounded-lg border border-base-border bg-base-surface2 p-1">
              <Link href="/binder?view=collection" className={`min-h-9 inline-flex items-center rounded-md px-3 text-xs ${layout === "grid" ? "bg-accent/15 text-accent-bright" : "text-ink-muted"}`}>Griglia</Link>
              <Link href="/binder?view=collection&layout=table" className={`min-h-9 inline-flex items-center rounded-md px-3 text-xs ${layout === "table" ? "bg-accent/15 text-accent-bright" : "text-ink-muted"}`}>Tabella</Link>
            </div>
          )}
        </div>
      )}

      {cards && cards.length > 0 && <p className="mb-5 text-xs text-ink-faint">
        La stima attuale considera la quantità posseduta e, quando nota, la lingua della copia; resta comunque su prezzi di riferimento che possono avere una condizione diversa dalle tue carte.
      </p>}

      {session && cards && cards.length > 0 && (
        <div className="mb-7">
          {historyError ? (
            <div role="alert" className="rounded-card border border-signal-down/30 bg-base-surface p-5 text-sm">
              <p>{historyError}</p>
              <button type="button" onClick={() => setHistoryAttempt((attempt) => attempt + 1)} className="min-h-11 mt-2 text-accent-bright underline">Riprova storico</button>
            </div>
          ) : valueHistory === null ? (
            <div role="status" aria-label="Caricamento storico" className="rounded-card border border-base-border bg-base-surface p-5 h-40 animate-pulse" />
          ) : (
            <CollectionValueChart points={valueHistory} />
          )}
        </div>
      )}

      {cards === null && !error && <div className="py-20 text-center text-sm font-mono text-ink-muted animate-pulse">Carico la collezione…</div>}
      {error && <div className="rounded-card border border-signal-down/30 bg-signal-down/5 p-5 text-signal-down">{error}</div>}
      {cards && cards.length === 0 && <div className="rounded-card border border-base-border bg-base-surface/60 py-20 px-5 text-center text-ink-muted">Il Binder è ancora vuoto. Dal catalogo usa la stella su una carta per aggiungerla.</div>}

      {cards && cards.length > 0 && view === "collection" && (
        layout === "table" ? (
          <BinderTable
            cards={cards}
            trends={trends}
            returnTo={returnTo}
            quantities={quantityById}
            onQuantityChange={changeQuantity}
            ownedLanguageMatches={ownedLanguageMatchById}
            onLogPurchase={session ? (card) => setPurchaseModalCard(card) : undefined}
            cardsWithPurchaseInfo={cardsWithPurchaseInfo}
          />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6">
            {cards.map((card, index) => (
              // priceProfile="best" (non il default "esatto" IT+NM+Zero):
              // qui la domanda e' "quanto vale la mia collezione", serve
              // sempre un numero anche per le carte senza una inserzione
              // IT+NM+Zero disponibile - coerente con "valore stimato" qui
              // sopra, calcolato sullo stesso campo (best_price_cents).
              <CardTile
                key={card.id}
                card={card}
                index={index}
                inBinder
                onToggleBinder={() => removeFromBinder(card.id)}
                returnTo={returnTo}
                priceProfile="best"
                quantity={quantityById.get(card.id) ?? 1}
                onQuantityChange={(quantity) => changeQuantity(card.id, quantity)}
                ownedLanguageMatch={ownedLanguageMatchById.get(card.id) ?? undefined}
                onLogPurchase={session ? () => setPurchaseModalCard(card) : undefined}
                hasPurchaseInfo={cardsWithPurchaseInfo.has(card.id)}
              />
            ))}
          </div>
        )
      )}
      {cards && cards.length > 0 && view === "book" && <BinderBook cards={cards} initialPage={initialPage} onPageChange={setBookPage} returnTo={returnTo} />}
      {purchaseModalCard && (
        <LogPurchaseModal
          card={purchaseModalCard}
          existingLot={primaryLotFor(lots ?? [], purchaseModalCard.id)}
          onClose={() => setPurchaseModalCard(null)}
          onSaved={handlePurchaseSaved}
        />
      )}
    </main>
  );
}

export default function BinderPage() {
  return <Suspense fallback={null}><BinderContent /></Suspense>;
}
