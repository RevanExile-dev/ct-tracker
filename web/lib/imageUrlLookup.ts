/**
 * Cerca l'URL immagine di un blueprint senza una query per ogni id.
 *
 * Motivo (consumo Neon): /api/scanner-image/<id> faceva una SELECT per ogni
 * carta diversa; lo scanner ne chiede decine per scansione e ogni query
 * sveglia il compute (spento solo dopo 5 minuti di silenzio, ore di calcolo
 * del piano gratuito). Misurato il 15/10/2026: 10.808 SELECT in 2 ore, il 97%
 * di tutte le query del sito. Qui l'elenco id -> URL si legge in UNA query e
 * resta in memoria dell'istanza per un'ora.
 *
 * - un id sconosciuto NON rilegge il database a ogni richiesta (un bot con id
 *   inventati non deve svegliarlo): al massimo una rilettura ogni
 *   `missReloadMs`, per accorgersi delle carte aggiunte dal sync catalogo;
 * - se la rilettura fallisce si continua con l'elenco vecchio.
 */
export type ImageUrlRow = { id: number; image_url: string | null };

export function createImageUrlLookup(
  loadAll: () => Promise<ImageUrlRow[]>,
  { ttlMs = 60 * 60 * 1000, missReloadMs = 5 * 60 * 1000, now = Date.now } = {}
) {
  let urls: Map<number, string> | null = null;
  let loadedAt = 0;
  let loading: Promise<void> | null = null;

  function refresh(): Promise<void> {
    if (!loading) {
      loading = loadAll()
        .then((rows) => {
          const next = new Map<number, string>();
          for (const row of rows) if (row.image_url) next.set(Number(row.id), row.image_url);
          urls = next;
          loadedAt = now();
        })
        .finally(() => {
          loading = null;
        });
    }
    return loading;
  }

  async function refreshKeepingOld() {
    try {
      await refresh();
    } catch (error) {
      if (!urls) throw error;
    }
  }

  return async function lookup(id: number): Promise<string | null> {
    if (!urls || now() - loadedAt > ttlMs) await refreshKeepingOld();
    let url = urls!.get(id);
    if (url === undefined && now() - loadedAt > missReloadMs) {
      await refreshKeepingOld();
      url = urls!.get(id);
    }
    return url ?? null;
  };
}
