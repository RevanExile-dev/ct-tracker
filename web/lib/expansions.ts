import releaseDates from "@/config/expansion_release_dates.json";

/**
 * CardTrader non fornisce una data di uscita per le espansioni: questo e' un
 * ordine APPROSSIMATO per era (Black & White -> Mega Evolution), dedotto dal
 * prefisso del code. All'interno della stessa era l'ordine non e' garantito
 * essere cronologico esatto. Usato come fallback in compareExpansions() qui
 * sotto quando non abbiamo una data reale verificata in
 * expansion_release_dates.json.
 */
export function eraRank(code: string): number {
  const c = code.toLowerCase();
  const BW = new Set([
    "blw", "epo", "nvi", "nxd", "dex", "drx", "bcr", "pls", "plf", "plb",
    "ltr", "dcr", "bwbsp", "bwpr",
  ]);
  const XY = new Set([
    "xy-en", "flf", "ffi", "phf", "prc", "ros", "aor", "bkt", "gen", "bkp",
    "fco", "sts", "evo", "xybsp", "pxy",
  ]);
  const SM = new Set([
    "sum", "gri", "bus", "slg", "cinv", "upr", "fli", "ces", "drm", "lot",
    "teu", "det", "unb", "hif", "unm", "cec", "smbs", "sm-p",
  ]);
  const SWSH = new Set([
    "ssh", "rcl", "daa", "cpa", "viv", "shf", "bst", "cre", "evs", "c25",
    "fst", "brs", "astr", "pkmgo", "lorg", "sit", "crz", "swshbs", "s-p",
  ]);
  const SV = new Set([
    "svi", "pal", "obf", "mew", "par", "paf", "tef", "twm", "sfa", "scr",
    "ssp", "pre", "jtg", "dri", "blk", "wht", "svpromo", "promosv",
  ]);
  const MEGA = new Set([
    "meg", "mep", "pfl", "asc", "por", "cri", "pbl", "30c", "30th-ch", "der",
  ]);

  if (c.startsWith("bw") || BW.has(c)) return 0;
  if (c.startsWith("xy") || XY.has(c)) return 1;
  if (c.startsWith("sm") || SM.has(c)) return 2;
  if (c.startsWith("sv") || SV.has(c)) return 4; // prima di "s\d" cosi' non collide con SWSH
  if (/^s\d/.test(c) || SWSH.has(c)) return 3;
  if (/^m\d/.test(c) || MEGA.has(c)) return 5;
  return 6; // sconosciuto: in fondo
}

const RELEASE_DATES = releaseDates as Record<string, string>;

/** Data di uscita verificata per un'espansione (formato ISO), o null se non
 * ancora confermata a mano — vedi web/config/expansion_release_dates.json. */
export function releaseDateFor(code: string): string | null {
  return RELEASE_DATES[code.toLowerCase()] ?? null;
}

/** Ordina piu' recenti prima quando la data e' nota per entrambe; le
 * espansioni con data nota vengono prima di quelle senza (che a loro volta
 * si ordinano con l'euristica per era, invariata per non peggiorare quello
 * che gia' funzionava). */
export function compareExpansions(
  a: { code: string; name: string },
  b: { code: string; name: string }
): number {
  const da = releaseDateFor(a.code);
  const db = releaseDateFor(b.code);
  if (da && db) return db.localeCompare(da);
  if (da && !db) return -1;
  if (!da && db) return 1;
  return eraRank(a.code) - eraRank(b.code) || a.name.localeCompare(b.name);
}

/** Uscite occidentali gia' annunciate e verificate su CardTrader ma ancora
 * future rispetto all'ultimo aggiornamento di questa lista. Se il catalogo
 * CardTrader contiene gia' i Singles, il sync le rende anche filtrabili; la
 * nota resta utile come promemoria della data di uscita ufficiale. */
export const UPCOMING_SETS: { name: string; expectedDate: string }[] = [
  { name: "30th Celebration", expectedDate: "16 set 2026" },
  { name: "Delta Reign", expectedDate: "6 nov 2026" },
];
