import { cachedJson, PRICES_CACHE } from "@/lib/apiCache";
import { fetchBestListings } from "@/lib/db.server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const listings = await fetchBestListings(Number(id));
  return cachedJson(listings, PRICES_CACHE);
}
