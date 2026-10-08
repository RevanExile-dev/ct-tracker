import type { MetadataRoute } from "next";
import { getPgPool } from "@/lib/pgPool";
import { getSiteUrl } from "@/lib/siteUrl";

// Rigenerata al massimo una volta al giorno (i prezzi si aggiornano piu'
// spesso, ma l'elenco delle carte cambia solo con il sync del catalogo):
// una singola query a Postgres per giorno, non una per ogni visita di un
// crawler. Se il database non risponde (es. build senza POSTGRES_URL) si
// pubblicano solo le pagine fisse.
export const revalidate = 86400;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = getSiteUrl();
  const entries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/movers`, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/scan`, changeFrequency: "monthly", priority: 0.5 },
  ];
  try {
    const { rows } = await getPgPool().query<{ id: number }>(
      "SELECT b.id FROM blueprints b JOIN latest_prices lp ON lp.blueprint_id = b.id ORDER BY b.id",
    );
    for (const r of rows) entries.push({ url: `${base}/card/${r.id}`, changeFrequency: "weekly", priority: 0.4 });
  } catch {
    // solo pagine fisse
  }
  return entries;
}
