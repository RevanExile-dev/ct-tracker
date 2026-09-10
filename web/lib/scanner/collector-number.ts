// Keep gallery prefixes as identity, and repair OCR confusions only in digits.
// Requiring token boundaries prevents a malformed/unknown prefix from silently
// becoming an ordinary numeric card number.
const COLLECTOR_PATTERN = /(?<![a-z0-9])((?:TG|GG|SV|RC)?)[ \t]*([0-9OoIiLl|SsBb]{1,4})[ \t]*[\/\\-][ \t]*((?:TG|GG|SV|RC)?)[ \t]*([0-9OoIiLl|SsBb]{1,4})(?![a-z0-9])/gi;

// S/B in piu' rispetto a O/I/L: aggiunti solo nella classe di caratteri della
// parte NUMERICA, mai nel prefisso (che resta l'alternanza esplicita
// TG|GG|SV|RC provata per prima dal motore regex - "SV107" continua a
// riconoscere "SV" come prefisso, non "S" come cifra, perche' il gruppo
// prefisso e' tentato PRIMA e consuma quei caratteri se l'alternanza
// combacia). Corregge letture tipiche tipo "S5/198" (5 letto S) o
// "1B5/198" (8 letto B) sulla parte cifre di carte NON gallery.
function digits(value: string) {
  return String(Number(
    value
      .replace(/[Oo]/g, "0")
      .replace(/[IiLl|]/g, "1")
      .replace(/[Ss]/g, "5")
      .replace(/[Bb]/g, "8"),
  ));
}

export function extractCollectorNumber(text: string): string | null {
  const matches = [...text.matchAll(COLLECTOR_PATTERN)];
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const [, leftPrefix, left, rightPrefix, right] = matches[i];
    // Gallery pairs must retain the prefix on both sides. Partial/ambiguous
    // readings are not exact-number evidence.
    if (leftPrefix.toUpperCase() !== rightPrefix.toUpperCase()) continue;
    if (Number(digits(right)) === 0) continue;
    return `${leftPrefix.toUpperCase()}${digits(left)}/${rightPrefix.toUpperCase()}${digits(right)}`;
  }
  return null;
}

export function stripCollectorNumbers(text: string): string {
  return text.replace(COLLECTOR_PATTERN, (match) => extractCollectorNumber(match) ? " " : match);
}

export function collectorParts(value: string | null) {
  if (!value) return null;
  const match = value.match(/^(TG|GG|SV|RC)?(\d{1,4})\/(TG|GG|SV|RC)?(\d{1,4})$/);
  if (!match || match[1] !== match[3]) return null;
  // Every caller today already routes through extractCollectorNumber() first,
  // which strips leading zeros - but this function is exported and has no
  // way to enforce that invariant on a future caller, so normalize here too
  // instead of relying on it. Idempotent on already-stripped input.
  return { prefix: match[1] ?? "", numerator: String(Number(match[2])), denominator: String(Number(match[4])) };
}
