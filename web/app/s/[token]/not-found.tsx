import type { Metadata } from "next";
import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "Link non valido",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
  alternates: { canonical: null },
};

export default function SharedNotFound() {
  return (
    <main className="mx-auto w-full max-w-[1600px] px-4 sm:px-8 py-8 sm:py-10">
      <SiteHeader compact />
      <section className="max-w-xl py-10 sm:py-16">
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink-primary">Questo link non è più valido</h1>
        <p className="mt-3 text-ink-muted">
          Chi te lo ha mandato potrebbe averlo disattivato o sostituito con uno nuovo. Chiedigli di mandartelo di nuovo.
        </p>
        <Link
          href="/"
          className="btn-lift mt-6 inline-block text-sm px-4 py-2.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 hover:bg-accent/15 transition-colors"
        >
          Vai a CartaViva
        </Link>
      </section>
    </main>
  );
}
