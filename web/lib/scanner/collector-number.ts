// Keep gallery prefixes as identity, and repair OCR confusions only in digits.
// Requiring token boundaries prevents a malformed/unknown prefix from silently
// becoming an ordinary numeric card number.
const COLLECTOR_PATTERN = /(?<![a-z0-9])((?:TG|GG|SV|RC)?)[ \t]*([0-9OoIiLl|]{1,4})[ \t]*[\/\\-][ \t]*((?:TG|GG|SV|RC)?)[ \t]*([0-9OoIiLl|]{1,4})(?![a-z0-9])/gi;

function digits(value: string) {
  return String(Number(value.replace(/[Oo]/g, "0").replace(/[IiLl|]/g, "1")));
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
  return { prefix: match[1] ?? "", numerator: match[2], denominator: match[4] };
}
