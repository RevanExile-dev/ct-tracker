"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useDialogA11y } from "@/lib/useDialogA11y";
import type { CardRow } from "@/lib/db";
import { addCardToProject, createProject, fetchProjects, type WishlistProject } from "@/lib/projects";

/** "Aggiungi a un progetto": sceglie un progetto esistente o ne crea uno nuovo
 * e ci mette una o piu' carte (menu a tre puntini o selezione multipla). */
export default function AddToProjectModal({
  cards,
  onClose,
  onDone,
}: {
  cards: CardRow[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const { data: session, status } = useSession();
  const [projects, setProjects] = useState<WishlistProject[] | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ project: string; added: number } | null>(null);
  const dialogRef = useDialogA11y<HTMLDivElement>();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchProjects()
      .then((p) => { if (!cancelled) setProjects(p); })
      .catch((e) => { if (!cancelled) setError(String(e?.message ?? e)); });
    return () => { cancelled = true; };
  }, [session]);

  async function put(project: WishlistProject) {
    setBusy(true);
    setError(null);
    let added = 0;
    try {
      for (const card of cards) {
        if (!project.cardIds.includes(card.id)) {
          await addCardToProject(project.id, card.id);
          added += 1;
        }
      }
      setResult({ project: project.name, added });
      onDone?.();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      if (added > 0) setResult({ project: project.name, added });
    } finally {
      setBusy(false);
    }
  }

  async function createAndPut() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const project = await createProject(trimmed);
      setBusy(false);
      await put(project);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setBusy(false);
    }
  }

  const title = cards.length === 1 ? cards[0].name : `${cards.length} carte selezionate`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Aggiungi a un progetto"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-card border border-base-border bg-base-surface shadow-card p-5 max-h-[90vh] overflow-y-auto"
      >
        <div className="text-ink-primary font-medium">Aggiungi a un progetto</div>
        <p className="text-sm text-ink-muted mt-1 break-words">{title}</p>

        {status !== "loading" && !session && (
          <p className="text-sm text-ink-muted mt-4">
            I progetti sono salvati nel tuo account: <Link href="/login" className="text-accent-bright underline underline-offset-2">accedi</Link> per usarli.
          </p>
        )}

        {session && result && (
          <div className="mt-4" data-testid="project-result">
            <p className="text-sm text-ink-primary">
              {result.added > 0
                ? `Aggiunte ${result.added} ${result.added === 1 ? "carta" : "carte"} a «${result.project}».`
                : `Erano già tutte in «${result.project}».`}
            </p>
            <div className="mt-3 flex gap-2">
              <Link href="/wishlist/progetti" className="flex-1 text-center text-sm min-h-11 inline-flex items-center justify-center rounded-card border border-accent/30 bg-accent/10 text-accent-bright">
                Vedi i progetti
              </Link>
              <button type="button" onClick={onClose} className="flex-1 text-sm min-h-11 rounded-card border border-base-border text-ink-muted">
                Chiudi
              </button>
            </div>
          </div>
        )}

        {session && !result && (
          <div className="mt-4 space-y-4">
            {projects === null && !error && <p className="text-sm text-ink-faint font-mono">Carico i progetti…</p>}
            {projects && projects.length > 0 && (
              <ul className="space-y-2" aria-label="I tuoi progetti">
                {projects.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => put(p)}
                      className="w-full text-left min-h-11 px-3 py-2 rounded-card border border-base-border bg-base-surface2 hover:border-accent/60 disabled:opacity-50 flex items-center justify-between gap-2"
                    >
                      <span className="text-sm text-ink-primary truncate">{p.name}</span>
                      <span className="text-xs font-mono text-ink-faint shrink-0">{p.cardIds.length} carte</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              onSubmit={(e) => { e.preventDefault(); void createAndPut(); }}
              className="flex gap-2"
            >
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                placeholder="Nuovo progetto (es. Completare il binder)"
                aria-label="Nome del nuovo progetto"
                className="flex-1 min-w-0 min-h-11 px-3 rounded-card border border-base-border bg-base-surface2 text-sm text-ink-primary"
              />
              <button
                type="submit"
                disabled={busy || !name.trim()}
                className="min-h-11 px-4 text-sm rounded-card border border-accent/30 bg-accent/10 text-accent-bright disabled:opacity-50"
              >
                Crea
              </button>
            </form>
          </div>
        )}

        {error && <p role="alert" className="text-sm text-signal-down mt-3">{error}</p>}
        {!result && (
          <button type="button" onClick={onClose} className="mt-4 w-full text-sm min-h-11 rounded-card border border-base-border text-ink-muted">
            Annulla
          </button>
        )}
      </div>
    </div>
  );
}
