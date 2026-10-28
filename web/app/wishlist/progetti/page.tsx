"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { CardRow, fetchCards } from "@/lib/db";
import { getBinderIds } from "@/lib/binder";
import { formatCents } from "@/lib/format";
import { fetchProjects, projectTotals, type WishlistProject } from "@/lib/projects";
import LoadError from "@/components/LoadError";
import SiteHeader from "@/components/SiteHeader";

function ProjectsContent() {
  const { data: session, status } = useSession();
  const [projects, setProjects] = useState<WishlistProject[] | null>(null);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [owned, setOwned] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const frame = requestAnimationFrame(() => setOwned(getBinderIds()));
    fetchProjects()
      .then(async (list) => {
        const ids = Array.from(new Set(list.flatMap((p) => p.cardIds)));
        const rows = ids.length ? await fetchCards({ ids }) : [];
        if (!cancelled) { setProjects(list); setCards(rows); }
      })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)); });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [session, tick]);

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  return (
    <main className="max-w-7xl mx-auto px-5 sm:px-8 py-12">
      <SiteHeader compact />
      <Link
        href="/wishlist"
        className="text-sm text-ink-muted hover:text-accent-bright transition-colors inline-flex items-center gap-1.5 min-h-11 md:min-h-9 mb-4 md:mb-8"
      >
        ← Lista desideri
      </Link>
      <h1 className="font-display text-2xl sm:text-3xl font-bold text-ink-primary">📁 Progetti</h1>
      <p className="text-ink-muted mt-1 max-w-xl">
        Sottocartelle dei desideri, per esempio completare un binder. Ogni progetto ti dice quante carte mancano e quanto costano in totale. Le aggiungi dalla ricerca, con i tre puntini ⋯ o con la selezione multipla.
      </p>

      {status !== "loading" && !session && (
        <p className="mt-10 text-ink-muted">
          I progetti sono salvati nel tuo account. <Link href="/login" className="text-accent-bright underline underline-offset-2">Accedi</Link> per usarli.
        </p>
      )}

      {error && <LoadError title="Non riesco a caricare i progetti." detail={error} onRetry={() => { setError(null); setProjects(null); setTick((t) => t + 1); }} />}
      {session && projects === null && !error && (
        <div className="mt-16 text-center text-ink-muted font-mono text-sm">Carico i progetti…</div>
      )}

      {projects && projects.length === 0 && (
        <div className="mt-16 text-center text-ink-muted">
          <p>Non hai ancora nessun progetto. Nel catalogo tocca ⋯ su una carta, oppure «Selezione multipla», e scegli «Metti in un progetto».</p>
          <Link href="/" className="btn-lift mt-5 inline-flex items-center min-h-11 px-4 text-sm rounded-card border border-accent/30 bg-accent/10 text-accent-bright">
            Vai alla ricerca
          </Link>
        </div>
      )}

      {projects && projects.length > 0 && (
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => {
            const t = projectTotals(p.cardIds.map((id) => byId.get(id) ?? { id }), owned);
            return (
              <li key={p.id}>
                <Link
                  href={`/wishlist/progetti/${p.id}`}
                  className="block rounded-card border border-base-border bg-base-surface px-5 py-4 hover:border-accent/60 transition-colors"
                  data-testid="project-link"
                >
                  <div className="font-display text-lg font-bold text-ink-primary break-words">{p.name}</div>
                  <div className="mt-2 text-sm text-ink-muted">
                    {p.cardIds.length === 0
                      ? "Vuoto"
                      : t.missing === 0
                        ? "Completo: hai già tutte le carte 🎉"
                        : `Mancano ${t.missing} ${t.missing === 1 ? "carta" : "carte"} su ${p.cardIds.length}`}
                  </div>
                  {t.missing > 0 && (
                    <div className="font-display text-xl font-bold text-ink-primary mt-1">{formatCents(t.cents)}</div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

export default function ProjectsPage() {
  return (
    <Suspense fallback={null}>
      <ProjectsContent />
    </Suspense>
  );
}
