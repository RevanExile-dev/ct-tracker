"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  MIN_MOVER_LISTINGS, fetchCardDetail, fetchCards, fetchCatalogStats, fetchMeta, fetchMoversPage, fetchPriceHistory,
  type PricePoint,
} from "@/lib/db";
import { formatNumber } from "@/lib/format";
import { SAMPLE, TYPE_COLORS, eur, fromRow, type DCard } from "./model";
import { CardFace, Delta, Icon, Logo, Rarity, Seg, Spark, TypeDot } from "./parts";

type View = { name: "home" } | { name: "binder" } | { name: "card"; id: number | string; seed?: DCard };

type Home = {
  phase: "loading" | "live" | "sample";
  featured: DCard[];
  rise: DCard[];
  drop: DCard[];
  moversAvailable: boolean;
  total: number | null;
  sync: string | null;
};

const EMPTY_HOME: Home = { phase: "loading", featured: [], rise: [], drop: [], moversAvailable: true, total: null, sync: null };

function formatSync(raw: string | undefined): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" }).format(d);
}

async function loadHome(): Promise<Home> {
  const [top, rise, drop, stats, meta] = await Promise.all([
    fetchCards({ sortBy: "price_desc", limit: 120 }),
    fetchMoversPage({ direction: "rise" }).catch(() => null),
    fetchMoversPage({ direction: "drop" }).catch(() => null),
    fetchCatalogStats().catch(() => null),
    fetchMeta().catch(() => null),
  ]);
  const all = top.map(fromRow).filter((c) => c.img && c.price != null);
  // Carte care ma con prezzo credibile: servono almeno alcune inserzioni, come per i movimenti.
  const solid = all.filter((c) => (c.listings ?? 0) >= MIN_MOVER_LISTINGS);
  const featured = (solid.length >= 5 ? solid : all).slice(0, 5);
  return {
    phase: "live",
    featured,
    rise: rise ? rise.cards.slice(0, 4).map(fromRow) : [],
    drop: drop ? drop.cards.slice(0, 4).map(fromRow) : [],
    moversAvailable: !!(rise?.available || drop?.available),
    total: stats?.totalCards ?? null,
    sync: formatSync(meta?.["last_price_sync"]),
  };
}

function sampleHome(): Home {
  const S = SAMPLE;
  return {
    phase: "sample",
    featured: [S[1], S[0], S[5], S[8], S[2]],
    rise: S.filter((c) => (c.delta ?? 0) > 0).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0)).slice(0, 4),
    drop: S.filter((c) => (c.delta ?? 0) < 0).sort((a, b) => (a.delta ?? 0) - (b.delta ?? 0)).slice(0, 4),
    moversAvailable: true,
    total: null,
    sync: null,
  };
}

/* ---------- elementi ripetuti ---------- */
function Tile({ c, onOpen }: { c: DCard; onOpen: (c: DCard) => void }) {
  return (
    <article className="cv-tile">
      <CardFace card={c} onOpen={() => onOpen(c)} />
      <div className="cv-tile-meta">
        <div className="cv-tile-set"><TypeDot type={c.type} /><span className="cv-num">{c.tag}</span><Rarity card={c} /></div>
        <button type="button" className="cv-name-btn" onClick={() => onOpen(c)}>{c.name}</button>
        <div className="cv-tile-set" style={{ marginTop: -2 }}><span>{c.set}</span></div>
        <div className="cv-tile-price">
          <span className={c.price == null ? "cv-price cv-nodata" : "cv-price"}>{eur(c.price)}</span>
          <Delta d={c.delta} />
        </div>
      </div>
    </article>
  );
}

function MoverRow({ c, onOpen }: { c: DCard; onOpen: (c: DCard) => void }) {
  return (
    <div className="cv-row">
      <div className="cv-th"><CardFace card={c} onOpen={() => onOpen(c)} /></div>
      <div>
        <button type="button" className="cv-name-btn cv-nm" onClick={() => onOpen(c)}>{c.name}</button>
        <div className="cv-sub"><TypeDot type={c.type} /><span className="cv-num">{c.tag}</span><Rarity card={c} /></div>
      </div>
      {c.spark ? <Spark data={c.spark} up={(c.delta ?? 0) >= 0} /> : <span />}
      <span className="cv-price">{eur(c.price)}</span>
      <Delta d={c.delta} />
    </div>
  );
}

function SkeletonHome() {
  return (
    <div aria-busy="true" aria-label="Caricamento delle carte">
      <div className="cv-rail">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="cv-tile">
            <div className="cv-skel" style={{ aspectRatio: "5 / 7", borderRadius: "4.6% / 3.3%" }} />
            <div className="cv-skel" style={{ height: 12, width: "40%" }} />
            <div className="cv-skel" style={{ height: 16, width: "80%" }} />
            <div className="cv-skel" style={{ height: 16, width: "55%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Home ---------- */
function HomeView({ home, onOpen, onRetry }: { home: Home; onOpen: (c: DCard) => void; onRetry: () => void }) {
  const live = home.phase === "live";
  return (
    <main className="cv-page" id="contenuto">
      {home.phase === "sample" && (
        <div className="cv-banner" role="status">
          <b>Carte d&apos;esempio.</b> Da questo indirizzo non riesco a leggere il catalogo vero, quindi vedi illustrazioni e prezzi inventati per far vedere lo stile.{" "}
          <button type="button" className="cv-back" style={{ display: "inline", minHeight: 0, color: "var(--accent)", textDecoration: "underline" }} onClick={onRetry}>Riprova</button>
        </div>
      )}
      <div>
        <div className="cv-status">
          <span className="cv-dot" />
          {live
            ? <>Prezzi{home.sync ? ` aggiornati il ${home.sync}` : ""}{home.total ? ` · ${formatNumber(home.total)} carte` : ""}</>
            : home.phase === "loading" ? "Carico i prezzi…" : "Dati d'esempio"}
        </div>
        <div className="cv-chips" style={{ marginTop: 12 }} aria-label="Come sono calcolati i prezzi">
          <span className="cv-chip">Lingua <b>Italiano</b></span>
          <span className="cv-chip">Condizione <b>Near Mint</b></span>
          <span className="cv-chip">Venditori <b>CardTrader Zero</b></span>
        </div>
      </div>

      <section aria-labelledby="h-evid">
        <div className="cv-sec-h"><h4 id="h-evid">In evidenza</h4><small>Almeno {MIN_MOVER_LISTINGS} inserzioni per ogni prezzo</small></div>
        {home.phase === "loading" ? <SkeletonHome /> : home.featured.length === 0
          ? <div className="cv-empty">Nessuna carta con prezzo da mostrare per ora.</div>
          : <div className="cv-rail">{home.featured.map((c) => <Tile key={c.id} c={c} onOpen={onOpen} />)}</div>}
      </section>

      <section aria-labelledby="h-mov" id="movimenti">
        <div className="cv-sec-h">
          <h4 id="h-mov">Carte in movimento</h4>
          <small>{live ? <>Variazione dall&apos;ultima rilevazione · <Link href="/movers" style={{ color: "var(--accent)" }}>vedi tutte</Link></> : "Variazione dall'ultima rilevazione"}</small>
        </div>
        {home.phase === "loading" ? (
          <div className="cv-skel" style={{ height: 160 }} aria-busy="true" />
        ) : !home.moversAvailable || (home.rise.length === 0 && home.drop.length === 0) ? (
          <div className="cv-empty">I movimenti non sono ancora disponibili: servono almeno due rilevazioni con abbastanza inserzioni.</div>
        ) : (
          <div className="cv-cols">
            <div>
              <div className="cv-eyebrow" style={{ marginBottom: 6 }}>Rialzi</div>
              {home.rise.length ? home.rise.map((c) => <MoverRow key={c.id} c={c} onOpen={onOpen} />) : <div className="cv-note">Nessun rialzo affidabile oggi.</div>}
            </div>
            <div>
              <div className="cv-eyebrow" style={{ marginBottom: 6 }}>Ribassi</div>
              {home.drop.length ? home.drop.map((c) => <MoverRow key={c.id} c={c} onOpen={onOpen} />) : <div className="cv-note">Nessun ribasso affidabile oggi.</div>}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

/* ---------- Scheda carta ---------- */
type Detail = { id: number | string; status: "ready" | "missing" | "error"; card?: DCard; artist?: string | null; best?: { cents: number | null; lang: string | null; cond: string | null }; history: PricePoint[] };

const PERIODS = [{ v: "7", l: "7G", days: 7 }, { v: "30", l: "30G", days: 30 }, { v: "90", l: "90G", days: 90 }, { v: "365", l: "1A", days: 365 }] as const;

function niceTicks(mn: number, mx: number): number[] {
  const span = mx - mn || Math.max(mx * 0.1, 0.1);
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const start = Math.floor(mn / step) * step;
  const out: number[] = [];
  for (let v = start; v < mx + step; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

function Chart({ points, label }: { points: { t: number; v: number }[]; label: string }) {
  const W = 520, H = 190, L = 44, R = 14, T = 12, B = 24;
  const vs = points.map((p) => p.v);
  const ticks = niceTicks(Math.min(...vs), Math.max(...vs));
  const mn = ticks[0], mx = ticks[ticks.length - 1];
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const x = (t: number) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const y = (v: number) => T + ((mx - v) / (mx - mn || 1)) * (H - T - B);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const dateFmt = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short" });
  const tf = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {ticks.map((tk) => (
        <g key={tk}>
          <line x1={L} x2={W - R} y1={y(tk).toFixed(1)} y2={y(tk).toFixed(1)} stroke="var(--line)" strokeWidth="1" />
          <text x={L - 8} y={(y(tk) + 3.5).toFixed(1)} textAnchor="end">{tf.format(tk)}</text>
        </g>
      ))}
      <text x={L} y={H - 6} textAnchor="start">{dateFmt.format(t0)}</text>
      <text x={W - R} y={H - 6} textAnchor="end">{dateFmt.format(t1)}</text>
      <path d={`${line} L${x(last.t).toFixed(1)} ${H - B} L${L} ${H - B}Z`} fill="var(--accent)" opacity=".13" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.t).toFixed(1)} cy={y(last.v).toFixed(1)} r="6" fill="var(--accent)" opacity=".25" />
      <circle cx={x(last.t).toFixed(1)} cy={y(last.v).toFixed(1)} r="3.2" fill="var(--accent)" />
    </svg>
  );
}

function CardView({ id, seed, onBack }: { id: number | string; seed?: DCard; onBack: () => void }) {
  const isSample = typeof id === "string";
  const [live, setLive] = useState<Detail | null>(null);
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["v"]>("30");
  const [tick, setTick] = useState(0);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    if (typeof id === "string") return;
    let alive = true;
    Promise.all([fetchCardDetail(id), fetchPriceHistory(id).catch(() => [] as PricePoint[])])
      .then(([row, history]) => {
        if (!alive) return;
        if (!row) return setLive({ id, status: "missing", history: [] });
        setLive({
          id, status: "ready", card: fromRow(row), artist: row.artist, history,
          best: { cents: row.best_price_cents, lang: row.best_language, cond: row.best_condition },
        });
      })
      .catch(() => alive && setLive({ id, status: "error", history: [] }));
    return () => { alive = false; };
  }, [id, tick]);

  const detail: Detail | null = isSample ? { id, status: "ready", card: seed, history: [] } : live && live.id === id ? live : null;
  const card = detail?.card;

  let series: { t: number; v: number }[] = [];
  if (card && isSample && card.spark) {
    series = card.spark.map((v, i, a) => ({ t: now - (a.length - 1 - i) * 86400000, v }));
  } else if (detail) {
    series = detail.history
      .filter((p) => p.it_nm_zero_price_cents != null)
      .map((p) => ({ t: new Date(p.captured_at).getTime(), v: (p.it_nm_zero_price_cents as number) / 100 }))
      .filter((p) => !Number.isNaN(p.t))
      .sort((a, b) => a.t - b.t);
    const days = PERIODS.find((p) => p.v === period)?.days ?? 30;
    if (series.length) {
      const from = series[series.length - 1].t - days * 86400000;
      series = series.filter((p) => p.t >= from);
    }
  }

  return (
    <main className="cv-page" id="contenuto">
      <div><button type="button" className="cv-back" onClick={onBack}>{Icon.left}Torna alle carte</button></div>
      {!detail ? (
        <div className="cv-detail" aria-busy="true" aria-label="Caricamento della carta">
          <div className="cv-skel" style={{ aspectRatio: "5 / 7", maxWidth: 300 }} />
          <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
            <div className="cv-skel" style={{ height: 36, width: "60%" }} />
            <div className="cv-skel" style={{ height: 18, width: "40%" }} />
            <div className="cv-skel" style={{ height: 52, width: "35%" }} />
            <div className="cv-skel" style={{ height: 210 }} />
          </div>
        </div>
      ) : detail.status !== "ready" || !card ? (
        <div className="cv-empty">
          {detail.status === "missing" ? "Questa carta non c'è nel catalogo." : "Non riesco a caricare questa carta."}
          <div><button type="button" className="cv-btn" onClick={detail.status === "error" ? () => { setLive(null); setTick((n) => n + 1); } : onBack}>
            {detail.status === "error" ? "Riprova" : "Torna alle carte"}
          </button></div>
        </div>
      ) : (
        <div className="cv-detail">
          <div className="cv-spot" style={card.type ? ({ "--c": TYPE_COLORS[card.type] } as React.CSSProperties) : undefined}>
            <CardFace card={card} />
          </div>
          <div>
            <h1 className="cv-d-title">{card.name}</h1>
            <div className="cv-d-sub">
              <TypeDot type={card.type} />
              <span>{card.set}</span>
              <span aria-hidden="true">·</span>
              <span className="cv-num">{card.tag}</span>
              {card.rarityLabel && <><span aria-hidden="true">·</span><Rarity card={card} /><span>{card.rarityLabel}</span></>}
              {detail.artist && <><span aria-hidden="true">·</span><span>Illustratore {detail.artist}</span></>}
            </div>
            <div className="cv-d-price">
              {card.price != null ? (
                <><span className="cv-big">{eur(card.price)}</span><Delta d={card.delta} /><small>{card.delta != null ? "rispetto alla rilevazione precedente" : "italiano · Near Mint · Zero"}</small></>
              ) : (
                <><span className="cv-big cv-nodata">—</span><small>nessuna inserzione italiana Near Mint con CardTrader Zero</small></>
              )}
            </div>
            <div className="cv-chart">
              <div className="cv-chart-h">
                <b style={{ fontSize: "0.95rem" }}>Andamento</b>
                {!isSample && <Seg label="Periodo" value={period} onChange={setPeriod} options={PERIODS.map((p) => ({ v: p.v, l: p.l }))} />}
              </div>
              {series.length >= 2
                ? <Chart points={series} label={`Andamento del prezzo: da ${eur(series[0].v)} a ${eur(series[series.length - 1].v)}`} />
                : <div className="cv-empty" style={{ marginTop: 10, border: 0 }}>Storico non ancora sufficiente per questo periodo.</div>}
            </div>
            <dl className="cv-facts">
              <div><dt>Prezzo esatto</dt><dd>{eur(card.price)}</dd></div>
              <div><dt>{isSample ? "Variazione" : "Miglior prezzo, ogni lingua"}</dt><dd>{isSample ? (card.delta != null ? `${card.delta > 0 ? "+" : "−"}${Math.abs(card.delta).toFixed(1).replace(".", ",")} %` : "—") : eur(detail.best?.cents != null ? detail.best.cents / 100 : null)}</dd></div>
              <div><dt>Inserzioni (esatto)</dt><dd>{card.listings ?? "—"}</dd></div>
            </dl>
            <div className="cv-actions">
              {isSample
                ? <span className="cv-note" style={{ margin: 0 }}>Carta d&apos;esempio: la scheda completa è disponibile sulle carte vere.</span>
                : <Link className="cv-btn cv-primary" href={`/card/${card.id}`}>Apri la scheda completa{Icon.ext}</Link>}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

/* ---------- Binder (esempio) ---------- */
const PER_PAGE = 9;
const isMissing = (i: number) => (i * 5 + 2) % 7 < 2;

function BinderView({ home, onOpen }: { home: Home; onOpen: (c: DCard) => void }) {
  const [state, setState] = useState<{ cards: DCard[]; set: string } | "loading" | "error">("loading");
  const [page, setPage] = useState(0);
  const [tick, setTick] = useState(0);
  const code = home.phase === "live" ? home.featured[0]?.tag.toLowerCase() : null;

  useEffect(() => {
    if (home.phase === "sample") return;
    if (home.phase === "loading" || !code) return;
    let alive = true;
    fetchCards({ expansionCode: code, sortBy: "expansion", limit: PER_PAGE * 4 })
      .then((rows) => { if (alive) setState({ cards: rows.map(fromRow), set: rows[0]?.expansion_name ?? "" }); })
      .catch(() => alive && setState("error"));
    return () => { alive = false; };
  }, [home.phase, code, tick]);

  const data = home.phase === "sample" ? { cards: SAMPLE, set: "Evoluzioni (esempio)" } : state;
  if (home.phase === "loading" || data === "loading") {
    return (
      <main className="cv-page" id="contenuto"><div className="cv-sheet" aria-busy="true" aria-label="Caricamento del binder">
        {Array.from({ length: PER_PAGE }, (_, i) => <div key={i} className="cv-pocket cv-skel" />)}
      </div></main>
    );
  }
  if (data === "error" || data.cards.length === 0) {
    return (
      <main className="cv-page" id="contenuto"><div className="cv-empty">
        Non riesco a caricare le carte dell&apos;esempio.
        <div><button type="button" className="cv-btn" onClick={() => { setState("loading"); setTick((n) => n + 1); }}>Riprova</button></div>
      </div></main>
    );
  }

  const pages = Math.max(1, Math.ceil(data.cards.length / PER_PAGE));
  const p = Math.min(page, pages - 1);
  const slice = data.cards.slice(p * PER_PAGE, p * PER_PAGE + PER_PAGE);
  const flags = slice.map((_, i) => !isMissing(p * PER_PAGE + i));
  const owned = slice.filter((_, i) => flags[i]);
  const total = owned.reduce((s, c) => s + (c.price ?? 0), 0);

  return (
    <main className="cv-page" id="contenuto">
      <div className="cv-banner">
        <b>Esempio.</b> Questo non è il tuo binder: sono carte vere dell&apos;espansione scelta, con alcune messe «mancanti» per mostrare le tasche numerate. Il binder vero, con il libro sfogliabile, è <Link href="/binder" style={{ color: "var(--accent)" }}>qui</Link>.
      </div>
      <div className="cv-b-head">
        <div>
          <h2 className="cv-b-title">{data.set}</h2>
          <p>{owned.length} carte su {slice.length} in questa pagina · mancano {slice.length - owned.length} · valore stimato {eur(total)}</p>
          <div className="cv-prog" role="img" aria-label={`${owned.length} carte su ${slice.length}`}>
            {flags.map((on, i) => <i key={i} className={on ? "cv-on" : ""} />)}
          </div>
        </div>
      </div>
      <div className="cv-sheet" aria-label={`Pagina ${p + 1} del binder d'esempio`}>
        {slice.map((c, i) => flags[i]
          ? <div key={c.id} className="cv-pocket"><CardFace card={c} onOpen={() => onOpen(c)} /></div>
          : (
            <div key={c.id} className="cv-pocket cv-empty-slot">
              <div className="cv-n">{c.tag}<small>Manca</small><div className="cv-gname">{c.name}</div></div>
            </div>
          ))}
      </div>
      {pages > 1 && (
        <div className="cv-pager">
          <button type="button" aria-label="Pagina precedente" disabled={p === 0} onClick={() => setPage(p - 1)}>{Icon.left}</button>
          <span>Pagina {p + 1} di {pages}</span>
          <button type="button" aria-label="Pagina successiva" disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>{Icon.right}</button>
        </div>
      )}
    </main>
  );
}

/* ---------- Ricerca rapida ---------- */
function Palette({ sample, suggestions, onClose, onPick }: { sample: boolean; suggestions: DCard[]; onClose: () => void; onPick: (c: DCard) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ q: string; cards: DCard[]; error?: boolean } | null>(null);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const term = q.trim();

  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    if (sample || !term) return;
    let alive = true;
    const t = setTimeout(() => {
      fetchCards({ search: term, limit: 6 })
        .then((rows) => alive && setRes({ q: term, cards: rows.map(fromRow) }))
        .catch(() => alive && setRes({ q: term, cards: [], error: true }));
    }, 200);
    return () => { alive = false; clearTimeout(t); };
  }, [term, sample]);

  const lower = term.toLowerCase();
  const items: DCard[] | null = !term
    ? suggestions.slice(0, 5)
    : sample
      ? SAMPLE.filter((c) => c.name.toLowerCase().includes(lower) || c.tag.toLowerCase().includes(lower) || c.set.toLowerCase().includes(lower)).slice(0, 6)
      : res && res.q === term ? res.cards : null;
  const failed = !!res?.error && res.q === term;
  const idx = items && items.length ? Math.min(sel, items.length - 1) : 0;

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
    else if (e.key === "ArrowDown" && items?.length) { e.preventDefault(); setSel(Math.min(idx + 1, items.length - 1)); }
    else if (e.key === "ArrowUp" && items?.length) { e.preventDefault(); setSel(Math.max(idx - 1, 0)); }
    else if (e.key === "Enter" && items?.[idx]) { e.preventDefault(); onPick(items[idx]); }
  };

  return (
    <div className="cv-pal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cv-pal-box" role="dialog" aria-modal="true" aria-label="Cerca carte" onKeyDown={onKey}>
        <div className="cv-pal-in">
          {Icon.search}
          <input
            ref={input} type="text" value={q} placeholder="Nome o numero della carta" autoComplete="off" enterKeyHint="search"
            aria-controls="cv-pal-list" aria-activedescendant={items?.length ? `cv-pal-${idx}` : undefined}
            onChange={(e) => { setQ(e.target.value); setSel(0); }}
          />
        </div>
        <ul className="cv-pal-list" id="cv-pal-list" role="listbox" aria-label="Risultati">
          {items === null && <li className="cv-pal-empty" aria-busy="true">Cerco…</li>}
          {failed && <li className="cv-pal-empty">La ricerca non risponde. Riprova tra poco.</li>}
          {items && !failed && items.length === 0 && <li className="cv-pal-empty">Nessuna carta trovata per «{term}». Prova con un altro nome.</li>}
          {items && !term && items.length > 0 && <li className="cv-pal-h" role="presentation">Carte in evidenza</li>}
          {items && !failed && items.map((c, i) => (
            <li key={c.id} id={`cv-pal-${i}`} className="cv-pal-it" role="option" aria-selected={i === idx} onClick={() => onPick(c)} onMouseEnter={() => setSel(i)}>
              <div><CardFace card={c} /></div>
              <div>
                <div className="cv-nm">{c.name}</div>
                <div className="cv-sub"><TypeDot type={c.type} /><span className="cv-num">{c.tag}</span><span>{c.set}</span></div>
              </div>
              <div><div className="cv-pr">{eur(c.price)}</div><Delta d={c.delta} /></div>
            </li>
          ))}
        </ul>
        <div className="cv-pal-ft"><span><kbd>↑</kbd><kbd>↓</kbd>scegli</span><span><kbd>Invio</kbd>apri</span><span><kbd>Esc</kbd>chiudi</span></div>
      </div>
    </div>
  );
}

/* ---------- guscio: testata, navigazione, tema ---------- */
type NavItem = { label: string; icon: ReactNode; key: "home" | "movimenti" | "binder" | "wishlist" | "scan" };
const NAV: NavItem[] = [
  { label: "Carte", icon: Icon.cards, key: "home" },
  { label: "Movimenti", icon: Icon.trend, key: "movimenti" },
  { label: "Binder", icon: Icon.binder, key: "binder" },
  { label: "Desideri", icon: Icon.heart, key: "wishlist" },
  { label: "Scanner", icon: Icon.scan, key: "scan" },
];
const THEME_KEY = "cv-demo-theme";

export default function DemoApp() {
  const [view, setView] = useState<View>({ name: "home" });
  const [home, setHome] = useState<Home>(EMPTY_HOME);
  const [tick, setTick] = useState(0);
  const [palette, setPalette] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark" | undefined>(undefined);
  const opener = useRef<HTMLElement | null>(null);
  const pendingScroll = useRef(false);

  useEffect(() => {
    let alive = true;
    loadHome().then((h) => alive && setHome(h)).catch(() => alive && setHome(sampleHome()));
    return () => { alive = false; };
  }, [tick]);

  // Tema salvato (se il browser lo consente) e collegamenti diretti tipo /demo#binder o /demo#card=123.
  // setState dentro un callback (rAF), mai sincrono nel corpo dell'effetto (regola di lint del progetto).
  useEffect(() => {
    const fromHash = () => {
      const h = window.location.hash;
      if (h === "#binder") setView({ name: "binder" });
      const m = /^#card=(\d+)$/.exec(h);
      if (m) setView({ name: "card", id: Number(m[1]) });
    };
    const frame = requestAnimationFrame(() => {
      try {
        const t = localStorage.getItem(THEME_KEY);
        if (t === "light" || t === "dark") setTheme(t);
      } catch { /* storage non disponibile: resta il tema di sistema */ }
      fromHash();
    });
    window.addEventListener("hashchange", fromHash);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("hashchange", fromHash); };
  }, []);

  const go = useCallback((v: View) => {
    setView(v);
    setPalette(false);
    const hash = v.name === "binder" ? "#binder" : v.name === "card" && typeof v.id === "number" ? `#card=${v.id}` : "";
    try { window.history.replaceState(null, "", `${window.location.pathname}${hash}`); } catch { /* ignora */ }
    window.scrollTo({ top: 0 });
  }, []);
  const openCard = useCallback((c: DCard) => go({ name: "card", id: c.id, seed: c }), [go]);

  const openPalette = useCallback(() => {
    opener.current = document.activeElement as HTMLElement | null;
    setPalette(true);
  }, []);
  const closePalette = useCallback(() => {
    setPalette(false);
    opener.current?.focus?.({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (!palette && e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") { e.preventDefault(); openPalette(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [palette, openPalette]);

  useEffect(() => {
    if (pendingScroll.current && view.name === "home") {
      pendingScroll.current = false;
      document.getElementById("movimenti")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [view, home.phase]);

  const toggleTheme = () => {
    const dark = theme ? theme === "dark" : window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const next = dark ? "light" : "dark";
    setTheme(next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignora */ }
  };

  const active: NavItem["key"] = view.name === "binder" ? "binder" : "home";
  const press = (k: NavItem["key"]) => {
    if (k === "home") go({ name: "home" });
    else if (k === "binder") go({ name: "binder" });
    else if (k === "movimenti") { pendingScroll.current = true; if (view.name === "home") { pendingScroll.current = false; document.getElementById("movimenti")?.scrollIntoView({ behavior: "smooth", block: "start" }); } else go({ name: "home" }); }
  };
  const hrefOf = (k: NavItem["key"]) => (k === "wishlist" ? "/wishlist" : k === "scan" ? "/scan" : null);

  const navItem = (n: NavItem, tab: boolean) => {
    const href = hrefOf(n.key);
    const cur = n.key === active ? "page" : undefined;
    const body = tab ? <>{n.icon}{n.label}</> : n.label;
    return href
      ? <Link key={n.key} href={href} className="cv-navlink">{body}</Link>
      : <button key={n.key} type="button" className="cv-navlink" aria-current={cur} onClick={() => press(n.key)}>{body}</button>;
  };

  const sample = home.phase === "sample";
  return (
    <div className="cvd" data-theme={theme}>
      <a href="#contenuto" className="cv-skip">Vai al contenuto</a>
      <header className="cv-hd">
        <div className="cv-hd-in">
          <button type="button" className="cv-logo cv-logobtn" onClick={() => go({ name: "home" })} aria-label="CartaViva, torna alla home">
            <Logo />CartaViva<span className="cv-pill">demo</span>
          </button>
          <button type="button" className="cv-search" aria-label="Apri la ricerca" onClick={openPalette}>
            {Icon.search}<span>Cerca nome o numero, es. 034/108</span><kbd>/</kbd>
          </button>
          <nav className="cv-nav" aria-label="Sezioni">{NAV.map((n) => navItem(n, false))}</nav>
          <div className="cv-tools">
            <button type="button" className="cv-iconbtn" aria-label="Cerca" onClick={openPalette}>{Icon.search}</button>
            <button type="button" className="cv-tbtn" aria-label="Cambia tema chiaro o scuro" onClick={toggleTheme}>
              <span className="cv-themeicon" aria-hidden="true">{Icon.moon}</span>
            </button>
          </div>
        </div>
      </header>

      {view.name === "home" && <HomeView home={home} onOpen={openCard} onRetry={() => { setHome(EMPTY_HOME); setTick((n) => n + 1); }} />}
      {view.name === "card" && <CardView key={String(view.id)} id={view.id} seed={view.seed} onBack={() => go({ name: "home" })} />}
      {view.name === "binder" && <BinderView home={home} onOpen={openCard} />}

      <footer className="cv-foot">
        <span>Anteprima del nuovo aspetto{sample ? " · carte d'esempio" : ""}.</span>
        <Link href="/">Torna al sito attuale</Link>
      </footer>

      <nav className="cv-tabbar" aria-label="Sezioni">{NAV.map((n) => navItem(n, true))}</nav>
      {palette && <Palette sample={sample} suggestions={home.featured} onClose={closePalette} onPick={openCard} />}
    </div>
  );
}
