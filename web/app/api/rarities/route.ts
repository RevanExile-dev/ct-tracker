import { cachedJson, LISTS_CACHE } from "@/lib/apiCache";
import { fetchRarities } from "@/lib/db.server";

export async function GET() {
  return cachedJson(await fetchRarities(), LISTS_CACHE);
}
