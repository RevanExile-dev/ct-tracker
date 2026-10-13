// Dati del titolare per le pagine legali. I segnaposto tra parentesi quadre
// vanno sostituiti con i dati veri PRIMA del via: li puo' dare solo il
// titolare del sito. Finche' restano, la pagina li mostra in evidenza.
export const LEGAL_OWNER_NAME = "[NOME E COGNOME O RAGIONE SOCIALE DEL TITOLARE]";
export const LEGAL_OWNER_ADDRESS = "[INDIRIZZO O SEDE DEL TITOLARE, SE DA INDICARE]";
export const LEGAL_CONTACT_EMAIL = "[EMAIL DI CONTATTO]";
export const LEGAL_LAST_UPDATE = "13 ottobre 2026";

export function isPlaceholder(value: string): boolean {
  return value.startsWith("[");
}
