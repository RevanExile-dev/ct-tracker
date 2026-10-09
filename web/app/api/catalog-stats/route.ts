import { cachedJson, STATS_CACHE } from "@/lib/apiCache";
import { fetchCatalogStats } from "@/lib/db.server";

export async function GET() {
  return cachedJson(await fetchCatalogStats(), STATS_CACHE);
}
