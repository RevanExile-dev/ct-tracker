import { cachedJson, LISTS_CACHE } from "@/lib/apiCache";
import { fetchLanguages } from "@/lib/db.server";

export async function GET() {
  return cachedJson(await fetchLanguages(), LISTS_CACHE);
}
