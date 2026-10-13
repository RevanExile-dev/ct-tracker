import Link from "next/link";
import SiteHeader from "@/components/SiteHeader";
import { LEGAL_LAST_UPDATE } from "@/lib/legal";

export default function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main id="contenuto" tabIndex={-1} className="mx-auto w-full max-w-3xl px-5 sm:px-8 py-5 sm:py-8 focus:outline-none">
      <SiteHeader compact />
      <Link
        href="/"
        className="text-sm text-ink-muted hover:text-accent-bright transition-colors inline-flex items-center gap-1.5 mt-6 mb-6"
      >
        ← Torna al catalogo
      </Link>
      <h1 className="font-display text-3xl font-bold text-ink-primary">{title}</h1>
      <p className="text-xs text-ink-faint mt-1 mb-8">Ultimo aggiornamento: {LEGAL_LAST_UPDATE}</p>
      <div className="space-y-4 text-ink-muted leading-relaxed [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-ink-primary [&_h2]:pt-6 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_a]:text-accent-bright [&_a]:underline [&_strong]:text-ink-primary">
        {children}
      </div>
    </main>
  );
}

/** Dato che solo il titolare puo' fornire: se e' ancora un segnaposto lo evidenzia. */
export function Fill({ value }: { value: string }) {
  const missing = value.startsWith("[");
  return missing ? (
    <mark className="rounded bg-amber-400/25 px-1.5 py-0.5 text-ink-primary font-mono text-sm">{value}</mark>
  ) : (
    <strong>{value}</strong>
  );
}
