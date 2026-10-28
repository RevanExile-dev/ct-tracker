"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { CardRow, fetchCards } from "@/lib/db";
import { getBinderIds } from "@/lib/binder";
import { formatCents } from "@/lib/format";
import {
  deleteProject, fetchProjects, projectTotals, removeCardFromProject, renameProject, type WishlistProject,
} from "@/lib/projects";
import CardTile from "@/components/CardTile";
import LoadError from "@/components/LoadError";
import SiteHeader from "@/components/SiteHeader";

function ProjectContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: session, status } = useSession();
  const [project, setProject] = useState<WishlistProject | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const [owned, setOwned] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => setOwned(getBinderIds()));
    fetchProjects()
      .then(async (list) => {
        const found = list.find((p) => p.id === id) ?? null;
        if (cancelled) return;
        if (!found) { setNotFound(true); return; }
        const rows = found.cardIds.length ? await fetchCards({ ids: found.cardIds }) : [];
        if (!cancelled) { setProject(found); setCards(rows); }
      })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)); });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [session, id, tick]);

  const totals = useMemo(() => projectTotals(cards ?? [], owned), [cards, owned]);
  // Prima quelle che mancano (le piu' care in cima), poi quelle che hai gia'.
  const sorted = useMemo(() => {
    if (!cards) return null;
    const price = (c: CardRow) => c.best_price_cents ?? c.latest_price_cents ?? 0;
    return [...cards].sort((a, b) => Number(owned.has(a.id)) - Number(owned.has(b.id)) || price(b) - price(a));
  }, [cards, owned]);

  const handleRemove = useCallback(async (card: CardRow) => {
    setActionError(null);
    try {
      await removeCardFromProject(id, card.id);
      setCards((cur) => cur?.filter((c) => c.id !== card.id) ?? cur);
    } catch (e) {
      setActionError(String((e as Error)?.message ?? e));
    }
  }, [id]);

  async function handleRename() {
    if (!project) return;
    const name = window.prompt("Nuovo nome del progetto", project.name)?.trim();
    if (!name || name === project.name) return;
    try {
      await renameProject(project.id, name);
      setProject({ ...project, name });
    } catch (e) {
      setActionError(String((e as Error)?.message ?? e));
    }
  }

  async function handleDelete() {
    if (!project) return;
    if (!window.confirm(`Eliminare il progetto «${project.name}»? Le carte restano nella lista desideri e nel binder.`)) return;
    try {
      await deleteProject(project.id);
      router.push("/wishlist/progetti");
    } catch (e) {
      setActionError(String((e as Error)?.message ?? e));
    }
  }

  return (
    <main className="max-w-7xl mx-auto px-5 sm:px-8 py-12">
      <SiteHeader compact />
      <Link
        href="/wishlist/progetti"
        className="text-sm text-ink-muted hover:text-accent-bright transition-colors inline-flex items-center gap-1.5 min-h-11 md:min-h-9 mb-4 md:mb-8"
      >
        ← Progetti
      </Link>

      {status !== "loading" && !session && (
        <p className="text-ink-muted">
          <Link href="/login" className="text-accent-bright underline underline-offset-2">Accedi</Link> per vedere i tuoi progetti.
        </p>
      )}
      {notFound && <p className="text-ink-muted">Progetto non trovato.</p>}
      {error && <LoadError title="Non riesco a caricare il progetto." detail={error} onRetry={() => { setError(null); setTick((t) => t + 1); }} />}
      {session && !project && !notFound && !error && (
        <div className="mt-16 text-center text-ink-muted font-mono text-sm">Carico il progetto…</div>
      )}

      {project && sorted && (
        <>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink-primary break-words">📁 {project.name}</h1>
          <div className="mt-2 flex gap-4 text-sm">
            <button type="button" onClick={handleRename} className="min-h-11 text-ink-muted hover:text-accent-bright">Rinomina</button>
            <button type="button" onClick={handleDelete} className="min-h-11 text-ink-muted hover:text-signal-down">Elimina progetto</button>
          </div>
          {actionError && <p role="alert" className="text-sm text-signal-down">{actionError}</p>}

          {sorted.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-card border border-base-border bg-base-surface px-5 py-4">
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Carte che mancano</div>
                <div className="font-display text-xl font-bold text-ink-primary" data-testid="project-missing">
                  {totals.missing} <span className="text-sm font-normal text-ink-muted">su {sorted.length}</span>
                </div>
              </div>
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Costo di quello che manca</div>
                <div className="font-display text-xl font-bold text-ink-primary" data-testid="project-total">{formatCents(totals.cents)}</div>
                {totals.unpriced > 0 && (
                  <div className="text-[11px] text-ink-faint">
                    {totals.unpriced} {totals.unpriced === 1 ? "carta senza prezzo non inclusa" : "carte senza prezzo non incluse"}
                  </div>
                )}
              </div>
              <div>
                <div className="text-[11px] font-mono uppercase tracking-wider text-ink-faint">Già nel binder</div>
                <div className="font-display text-xl font-bold text-ink-primary">{totals.owned}</div>
              </div>
            </div>
          )}

          {sorted.length === 0 && (
            <p className="mt-10 text-ink-muted">Il progetto è vuoto. Aggiungi carte dalla ricerca con ⋯ o con la selezione multipla.</p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 sm:gap-5 mt-8">
            {sorted.map((card, i) => (
              <div key={card.id} className={owned.has(card.id) ? "opacity-60" : ""}>
                <CardTile card={card} index={i} returnTo={`/wishlist/progetti/${id}`} />
                <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                  <span className="text-ink-faint">{owned.has(card.id) ? "✓ nel binder" : ""}</span>
                  <button type="button" onClick={() => handleRemove(card)} className="min-h-11 px-2 text-ink-muted hover:text-signal-down">
                    Togli dal progetto
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}

export default function ProjectPage() {
  return (
    <Suspense fallback={null}>
      <ProjectContent />
    </Suspense>
  );
}
