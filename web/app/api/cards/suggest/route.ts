import { NextRequest, NextResponse } from "next/server";
import { fetchNameSuggestions } from "@/lib/db.server";

export async function GET(req: NextRequest) {
  const search = (req.nextUrl.searchParams.get("search") ?? "").slice(0, 80);
  // Sotto i 2 caratteri ogni nome corrisponde: niente query inutile.
  if (search.trim().length < 2) return NextResponse.json([]);
  return NextResponse.json(await fetchNameSuggestions(search));
}
