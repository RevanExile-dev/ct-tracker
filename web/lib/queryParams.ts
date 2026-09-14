/** Elenco separato da virgole in un parametro della query string (es.
 * ?rarity=Rare,Holo) - stessa forma usata da piu' pagine (catalogo, carte in
 * movimento) per rarita'/lingue/condizioni selezionate. */
export function splitCsv(value: string | null): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}
