import { cachedJson, LISTS_CACHE } from "@/lib/apiCache";
import { fetchArtists } from "@/lib/db.server";

export async function GET() {
  return cachedJson(await fetchArtists(), LISTS_CACHE);
}
