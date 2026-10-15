// Parti pure dei link di condivisione (nessun import server): le usano sia
// web/lib/share.server.ts sia i test unitari e il pannello client.

export type ShareKind = "binder" | "wishlist";

export const SHARE_KINDS: readonly ShareKind[] = ["binder", "wishlist"];
/** 24 byte casuali in base64url = 32 caratteri, 192 bit: non indovinabile. */
export const SHARE_TOKEN_BYTES = 24;
export const SHARE_TOKEN_LENGTH = 32;
export const MAX_SHARE_TITLE_LENGTH = 60;

export function isShareKind(value: unknown): value is ShareKind {
  return value === "binder" || value === "wishlist";
}

/** Forma del token: controllata PRIMA di toccare il database, cosi' un
 * indirizzo inventato a caso non costa nemmeno una query. */
export function isValidShareToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32}$/.test(value);
}

/** Titolo scelto dall'utente: testo semplice, spazi ripuliti, massimo 60
 * caratteri, senza caratteri di controllo. Vuoto = nessun titolo (la pagina
 * usa il titolo generico: mai il nome dell'account). null se non valido. */
export function normalizeShareTitle(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length > MAX_SHARE_TITLE_LENGTH) return undefined;
  return cleaned === "" ? null : cleaned;
}

export function defaultShareTitle(kind: ShareKind): string {
  return kind === "binder" ? "Un binder condiviso" : "Una lista desideri condivisa";
}

/** Percorso (relativo) della pagina pubblica di un link. */
export function sharePath(token: string): string {
  return `/s/${token}`;
}
