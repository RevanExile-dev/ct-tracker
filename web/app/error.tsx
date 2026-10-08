"use client";

import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto w-full max-w-[1600px] px-3 sm:px-8 py-10 sm:py-16">
      <section className="max-w-xl">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Qualcosa è andato storto</p>
        <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold text-ink-primary">
          Non sono riuscito a caricare la pagina
        </h1>
        <p className="mt-3 text-ink-muted">
          Può essere un problema temporaneo. Riprova tra un attimo: i tuoi dati nel Binder non sono stati toccati.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => reset()}
            className="btn-lift text-sm px-4 py-2.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 hover:bg-accent/15 transition-colors active:scale-95"
          >
            Riprova
          </button>
          <Link
            href="/"
            className="btn-lift text-sm px-4 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95"
          >
            Torna al catalogo
          </Link>
        </div>
      </section>
    </main>
  );
}
