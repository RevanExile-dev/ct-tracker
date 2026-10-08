import { cachedJson, LISTS_CACHE } from "@/lib/apiCache";
import { fetchExpansions } from "@/lib/db.server";

export async function GET() {
  return cachedJson(await fetchExpansions(), LISTS_CACHE);
}
