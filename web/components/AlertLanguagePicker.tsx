"use client";

/** Scelta delle lingue di un allarme prezzo: una o piu' caselle, l'allarme
 * scatta se il prezzo e' sotto soglia in UNA QUALSIASI delle lingue spuntate.
 * Nessuna casella = "qualunque lingua" (scelta esplicita, mostrata a parole).
 * Le lingue gia' salvate nell'allarme restano visibili anche se l'elenco
 * caricato dal server non le contiene (ancora, o piu'). */
export default function AlertLanguagePicker({
  idPrefix,
  options,
  selected,
  onChange,
  labelClassName = "block text-xs text-ink-faint mb-1",
}: {
  idPrefix: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  labelClassName?: string;
}) {
  const all = [...selected.filter((l) => !options.includes(l)), ...options];
  function toggle(lang: string) {
    onChange(selected.includes(lang) ? selected.filter((l) => l !== lang) : [...selected, lang]);
  }
  return (
    <fieldset>
      <legend className={labelClassName}>Lingue</legend>
      <div className="flex flex-wrap gap-2">
        {all.map((lang) => {
          const checked = selected.includes(lang);
          return (
            <label
              key={lang}
              htmlFor={`${idPrefix}-${lang}`}
              className={`inline-flex items-center gap-2 min-h-11 px-3 rounded-lg border text-sm cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-accent/70 ${
                checked
                  ? "bg-accent/10 border-accent/60 text-accent-bright"
                  : "bg-base-surface2 border-base-border text-ink-muted"
              }`}
            >
              <input
                id={`${idPrefix}-${lang}`}
                type="checkbox"
                checked={checked}
                onChange={() => toggle(lang)}
                className="accent-[var(--color-accent,#34d399)] h-4 w-4"
              />
              {lang}
            </label>
          );
        })}
      </div>
      <p className="text-xs text-ink-faint mt-1">
        {selected.length === 0
          ? "Nessuna spuntata: qualunque lingua."
          : selected.length === 1
            ? "Solo questa lingua."
            : "Scatta se il prezzo è sotto soglia in una qualsiasi di queste."}
      </p>
    </fieldset>
  );
}
