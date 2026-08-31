/** Colori confermati da uno screenshot reale della lista venditori di
 * CardTrader (NM verde, SP verde lime, MP ambra/arancione); Played/Poor
 * estrapolati sullo stesso gradiente verde->rosso. Scala a 5 livelli
 * verificata sui dati reali del catalogo (nessun "Heavily Played" trovato). */
const CONDITION_STYLES: Record<string, { label: string; className: string }> = {
  // Rarissima su CardTrader (1 inserzione su oltre 500k campionate) ma
  // reale, non un errore di battitura: un grado sopra Near Mint. Senza
  // questa voce cadeva nel fallback generico (label "MI", grigio neutro),
  // visibile nella UI come una pillola anomala/spenta tra le altre colorate.
  "Mint": {
    label: "MT",
    className: "bg-cyan-500/15 text-cyan-400 border-cyan-500/40",
  },
  "Near Mint": {
    label: "NM",
    className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/40",
  },
  "Slightly Played": {
    label: "SP",
    className: "bg-lime-500/15 text-lime-400 border-lime-500/40",
  },
  "Moderately Played": {
    label: "MP",
    className: "bg-amber-500/15 text-amber-400 border-amber-500/40",
  },
  "Played": {
    label: "PL",
    className: "bg-orange-500/15 text-orange-400 border-orange-500/40",
  },
  "Poor": {
    label: "PO",
    className: "bg-red-700/15 text-red-500 border-red-700/40",
  },
};

export default function ConditionBadge({
  condition,
}: {
  condition: string | null | undefined;
}) {
  if (!condition) return null;
  const style = CONDITION_STYLES[condition] ?? {
    label: condition.slice(0, 2).toUpperCase(),
    className: "bg-base-surface2 text-ink-muted border-base-border",
  };
  return (
    <span
      title={condition}
      className={`inline-flex items-center justify-center text-[10px] font-mono font-bold uppercase px-1.5 py-0.5 rounded border ${style.className}`}
    >
      {style.label}
    </span>
  );
}
