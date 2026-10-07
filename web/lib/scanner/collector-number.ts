// Keep gallery prefixes as identity, and repair OCR confusions only in digits.
// Requiring token boundaries prevents a malformed/unknown prefix from silently
// becoming an ordinary numeric card number.
// "(?!-P)": nelle promo giapponesi ("339/S-P") la S non e' una cifra letta
// male: senza questo controllo "339/S-P" diventava "339/5". Solo "-P" isolata,
// non "-p..." in generale: nei nomi file "...-066-pokemon-..." il numero resta.
const COLLECTOR_PATTERN = /(?<![a-z0-9])((?:TG|GG|SV|RC)?)[ \t]*([0-9OoIiLl|SsBb]{1,4})[ \t]*[\/\\-][ \t]*((?:TG|GG|SV|RC)?)[ \t]*([0-9OoIiLl|SsBb]{1,4})(?![a-z0-9]|-P(?![a-z]))/gi;

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

// Tutte le letture valide (non solo l'ultima): con piu' passate OCR sullo stesso
// campo, una lettura giusta non deve essere oscurata da una sbagliata successiva.
export function extractAllCollectorNumbers(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(COLLECTOR_PATTERN)) {
    const parsed = extractCollectorNumber(match[0]);
    if (parsed) found.add(parsed);
  }
  return [...found];
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

// Le promo non hanno un totale: le Black Star inglesi stampano sigla e numero
// ("MEP EN 099", "SVP EN 223", "SWSH220", "SM116", "XY143", "BW101", energie
// "MEE 007"), quelle giapponesi numero e sigla ("081/S-P", "019/XY-P",
// "025/30th-P" del 30esimo; CardTrader a volte scrive "BW-P 234"). Chiavi:
// "MEP 99" per le prime, "81/S-P" per le seconde, cosi' una promo inglese e
// una giapponese con lo stesso numero restano distinte.
// Rilevato sul campione di 705 carte (3 per espansione): l'OCR legge spesso la
// S delle sigle giapponesi come 5 ("231/5V-P", "118/5-P"), la B come 8.
const EN_PROMO_PATTERN = /(?<![a-z0-9])(MEP|MEE|SVP|SWSH|SM|XY|BW)[ \t]*(?:EN[ \t]*)?([0-9OoIl|]{1,3})(?![0-9])/gi;
const JP_CODE = "(30TH|XY|SM|5M|SV|5V|BW|8W|S|5)";
const JP_PROMO_PATTERN = new RegExp(`(?<![a-z0-9])([0-9OoIl|]{1,3})[ \\t]*/[ \\t]*${JP_CODE}[ \\t]*-[ \\t]*P(?![a-z])`, "gi");
const JP_PROMO_CODE_FIRST = new RegExp(`(?<![a-z0-9])${JP_CODE}-P[ \\t]+(\\d{1,3})(?![0-9])`, "gi");

function jpCode(code: string) {
  return code.toUpperCase().replace(/^5/, "S").replace(/^8/, "B");
}

function promoDigits(value: string): string | null {
  // Almeno una cifra vera: "SM Il" non e' un numero.
  if (!/\d/.test(value)) return null;
  const number = Number(value.replace(/[Oo]/g, "0").replace(/[IiLl|]/g, "1"));
  return number > 0 ? String(number) : null;
}

export function extractPromoNumbers(text: string): string[] {
  const found = new Set<string>();
  for (const [, code, value] of text.matchAll(EN_PROMO_PATTERN)) {
    const number = promoDigits(value);
    if (number) found.add(`${code.toUpperCase()} ${number}`);
  }
  for (const [, value, code] of text.matchAll(JP_PROMO_PATTERN)) {
    const number = promoDigits(value);
    if (number) found.add(`${number}/${jpCode(code)}-P`);
  }
  for (const [, code, value] of text.matchAll(JP_PROMO_CODE_FIRST)) {
    const number = promoDigits(value);
    if (number) found.add(`${number}/${jpCode(code)}-P`);
  }
  return [...found];
}

export function extractPromoNumber(text: string): string | null {
  return extractPromoNumbers(text)[0] ?? null;
}

/** Tutti i numeri leggibili nel testo, normali e promo, come chiavi di catalogo. */
export function extractAllNumberKeys(text: string): string[] {
  return [...extractAllCollectorNumbers(text), ...extractPromoNumbers(text)];
}
