import { cachedJson, STATS_CACHE } from "@/lib/apiCache";
import { fetchMeta } from "@/lib/db.server";

export async function GET() {
  return cachedJson(await fetchMeta(), STATS_CACHE);
}
