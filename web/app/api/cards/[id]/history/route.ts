import { cachedJson, PRICES_CACHE } from "@/lib/apiCache";
import { fetchPriceHistory } from "@/lib/db.server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const history = await fetchPriceHistory(Number(id));
  return cachedJson(history, PRICES_CACHE);
}
