import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Pagina non trovata",
  robots: { index: false },
  alternates: { canonical: null },
};

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-[1600px] px-3 sm:px-8 py-5 sm:py-8">
      <SiteHeader compact />
      <section className="max-w-xl py-10 sm:py-16">
        <p className="font-mono text-xs uppercase tracking-widest text-accent">Errore 404</p>
        <h1 className="mt-2 font-display text-3xl sm:text-4xl font-bold text-ink-primary">
          Questa pagina non esiste
        </h1>
        <p className="mt-3 text-ink-muted">
          L&apos;indirizzo potrebbe essere sbagliato oppure la carta non è più nel catalogo.
        </p>
        <Link
          href="/"
          className="btn-lift mt-6 inline-block text-sm px-4 py-2.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 hover:bg-accent/15 transition-colors active:scale-95"
        >
          ← Torna al catalogo
        </Link>
      </section>
    </main>
  );
}
