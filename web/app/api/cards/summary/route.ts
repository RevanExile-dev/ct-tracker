import { cachedJson, PRICES_CACHE } from "@/lib/apiCache";
import { NextRequest } from "next/server";
import { fetchCardsSummary } from "@/lib/db.server";
import { parseCardsFilterOpts } from "@/lib/apiParams";

export async function GET(req: NextRequest) {
  const opts = parseCardsFilterOpts(req.nextUrl.searchParams);
  const summary = await fetchCardsSummary(opts);
  return cachedJson(summary, PRICES_CACHE);
}
