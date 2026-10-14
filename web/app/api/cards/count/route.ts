import { cachedJson, PRICES_CACHE } from "@/lib/apiCache";
import { NextRequest } from "next/server";
import { fetchCardsCount } from "@/lib/db.server";
import { parseCardsFilterOpts } from "@/lib/apiParams";

export async function GET(req: NextRequest) {
  const opts = parseCardsFilterOpts(req.nextUrl.searchParams);
  const count = await fetchCardsCount(opts);
  return cachedJson({ count }, PRICES_CACHE);
}
