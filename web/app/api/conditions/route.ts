import { cachedJson, LISTS_CACHE } from "@/lib/apiCache";
import { fetchConditions } from "@/lib/db.server";

export async function GET() {
  return cachedJson(await fetchConditions(), LISTS_CACHE);
}
