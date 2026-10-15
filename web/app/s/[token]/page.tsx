import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import SiteHeader from "@/components/SiteHeader";
import { cardImageSources } from "@/lib/cardImage";
import { formatCents } from "@/lib/format";
import { getSharedCollection, type SharedCard } from "@/lib/share.server";
import { defaultShareTitle, isValidShareToken } from "@/lib/shareToken";

// Pagina pubblica di sola lettura per un link di condivisione. Nessun dato
// personale: ne' email ne' nome dell'account, solo le carte (vedi
// web/lib/share.server.ts per l'elenco esatto di cosa si vede).
export const dynamic = "force-dynamic";

const PAGE_SIZE = 60;

// Una sola lettura per richiesta: la usano sia i metadati sia la pagina.
const getShared = cache((token: string) => getSharedCollection(token));

function describe(kind: "binder" | "wishlist", cardsCount: number, copies: number, totalCents: number, currency: string): string {
  if (cardsCount === 0) return kind === "binder" ? "Un binder di carte Pokémon, per ora vuoto." : "Una lista desideri, per ora vuota.";
  const parts = [`${cardsCount} ${cardsCount === 1 ? "carta" : "carte"}`];
  if (kind === "binder" && copies !== cardsCount) parts.push(`${copies} copie`);
  if (totalCents > 0) parts.push(`${kind === "binder" ? "valore stimato" : "totale oggi"} ${formatCents(totalCents, currency)}`);
  return `${kind === "binder" ? "Binder" : "Lista desideri"} su CartaViva: ${parts.join(", ")}.`;
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const robots = { index: false, follow: false } as const;
  // Un errore del database non deve mai rompere il <head>: si ricade sul
  // titolo generico, senza anteprima specifica.
  let shared = null;
  try {
    shared = await getShared(token);
  } catch {
    return { title: "Collezione condivisa", robots, referrer: "no-referrer" };
  }
  if (!shared) return { title: "Link non valido", robots, referrer: "no-referrer" };

  const title = shared.title ?? defaultShareTitle(shared.kind);
  const description = describe(shared.kind, shared.cards.length, shared.totalCopies, shared.totalCents, shared.currency);
  const image = { url: `/s/${token}/og`, width: 1200, height: 630, alt: title };
  return {
    title,
    description,
    robots,
    // Il token e' nell'indirizzo: niente Referer verso altri siti.
    referrer: "no-referrer",
    alternates: { canonical: `/s/${token}` },
    openGraph: { type: "website", locale: "it_IT", siteName: "CartaViva", title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

const FINISH_LABEL: Record<string, string> = { foil: "Foil", reverse: "Reverse", normal: "Normale" };

function SharedTile({ card, showQuantity }: { card: SharedCard; showQuantity: boolean }) {
  const image = card.imageUrl ? cardImageSources(card.imageUrl) : null;
  const details = [card.language ? card.language.toUpperCase() : null, card.finish ? FINISH_LABEL[card.finish] ?? card.finish : null].filter(Boolean);
  return (
    <li className="rounded-card border border-base-border bg-base-surface overflow-hidden">
      <Link
        href={`/card/${card.id}`}
        className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70 focus-visible:ring-inset"
      >
        <div className="relative aspect-[5/7] bg-base-surface2">
          {image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              {...image}
              alt={card.name}
              sizes="(min-width: 1024px) 20vw, 45vw"
              loading="lazy"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-ink-faint text-xs font-mono">nessuna immagine</div>
          )}
          {showQuantity && card.quantity > 1 && (
            <span className="absolute top-2 right-2 text-xs font-mono px-2 py-0.5 rounded-full bg-black/70 border border-white/10 text-accent-bright">
              ×{card.quantity}
            </span>
          )}
        </div>
        <div className="px-3 pt-3">
          <div className="text-xs font-mono text-ink-faint truncate">{card.expansionName}</div>
          <div className="font-display font-medium text-ink-primary leading-snug mt-0.5 truncate">{card.name}</div>
        </div>
      </Link>
      <div className="px-3 pb-3 pt-1.5">
        <div className="font-mono text-lg text-ink-primary">{formatCents(card.cents, card.currency)}</div>
        {details.length > 0 && <div className="text-[11px] font-mono text-ink-faint">{details.join(" · ")}</div>}
      </div>
    </li>
  );
}

export default async function SharedPage({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ pagina?: string }>;
}) {
  const { token } = await params;
  if (!isValidShareToken(token)) notFound();
  const shared = await getShared(token);
  if (!shared) notFound();

  const { pagina } = await searchParams;
  const pages = Math.max(1, Math.ceil(shared.cards.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Math.floor(Number(pagina)) || 1));
  const visible = shared.cards.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const isBinder = shared.kind === "binder";
  const title = shared.title ?? defaultShareTitle(shared.kind);
  const pageHref = (n: number) => (n <= 1 ? `/s/${token}` : `/s/${token}?pagina=${n}`);

  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 sm:px-8 py-8 sm:py-10">
      <SiteHeader compact />
      <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink-primary break-words">{title}</h1>
      <p className="text-ink-muted mt-1">
        {isBinder ? "Una collezione di carte Pokémon, in sola lettura." : "Le carte che questa persona vorrebbe avere, in sola lettura."}
      </p>

      <div className="mt-6 mb-7 flex flex-wrap items-center gap-x-8 gap-y-3 rounded-card border border-base-border bg-base-surface/70 px-5 py-4">
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Carte</div>
          <div className="font-display text-xl font-bold">
            {shared.cards.length}
            {isBinder && shared.totalCopies !== shared.cards.length && (
              <span className="text-sm font-normal text-ink-faint ml-1.5">({shared.totalCopies} copie)</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">{isBinder ? "Valore stimato" : "Totale oggi"}</div>
          <div className="font-display text-xl font-bold text-accent-bright">{formatCents(shared.totalCents, shared.currency)}</div>
        </div>
        {shared.pricedCount < shared.cards.length && (
          <span className="text-xs text-ink-faint">{shared.pricedCount}/{shared.cards.length} con prezzo</span>
        )}
      </div>

      {shared.cards.length === 0 ? (
        <p className="rounded-card border border-base-border bg-base-surface/60 py-12 px-5 text-center text-ink-muted">
          Per ora non c&apos;è ancora nessuna carta.
        </p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 sm:gap-6" aria-label="Carte">
          {visible.map((card) => <SharedTile key={card.id} card={card} showQuantity={isBinder} />)}
        </ul>
      )}

      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-between gap-3 text-sm" aria-label="Pagine">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} rel="prev" className="inline-flex items-center min-h-11 px-4 rounded-card border border-base-border bg-base-surface hover:border-accent/60 transition-colors">← Precedenti</Link>
          ) : <span />}
          <span className="font-mono text-ink-muted" aria-current="page">Pagina {page} di {pages}</span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} rel="next" className="inline-flex items-center min-h-11 px-4 rounded-card border border-base-border bg-base-surface hover:border-accent/60 transition-colors">Successive →</Link>
          ) : <span />}
        </nav>
      )}

      <p className="mt-10 text-xs text-ink-faint max-w-2xl">
        I prezzi sono indicativi, dal mercato CardTrader, e possono avere condizione diversa dalle carte reali.{" "}
        <Link href="/" className="underline hover:text-accent-bright">Crea anche tu la tua collezione su CartaViva</Link>.
      </p>
    </main>
  );
}
