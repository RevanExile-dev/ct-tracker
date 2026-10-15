import Link from "next/link";

const LINKS = [
  { href: "/privacy", label: "Privacy" },
  { href: "/cookie", label: "Cookie" },
  { href: "/termini", label: "Termini d'uso" },
  { href: "/note-legali", label: "Note legali e contatti" },
];

export default function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-[1600px] px-3 sm:px-8 pb-8 pt-10 text-xs text-ink-faint">
      <nav aria-label="Informazioni legali" className="flex flex-wrap gap-x-5">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="inline-flex items-center min-h-11 sm:min-h-7 hover:text-accent-bright underline-offset-2 hover:underline">
            {l.label}
          </Link>
        ))}
      </nav>
      <p className="mt-3 max-w-3xl leading-relaxed">
        CartaViva è un progetto indipendente, non affiliato né approvato da The Pokémon Company,
        Nintendo, CardTrader, Cardmarket o TCGplayer. Pokémon e i nomi correlati sono marchi dei
        rispettivi titolari. Dati da CardTrader; i prezzi sono indicativi.
      </p>
    </footer>
  );
}
