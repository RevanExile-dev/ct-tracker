import { NextRequest, NextResponse } from "next/server";
import { fetchCards } from "@/lib/db.server";
import { parseCardsFilterOpts } from "@/lib/apiParams";
import type { SortOption } from "@/lib/types";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const opts = parseCardsFilterOpts(sp);
  const sortBy = (sp.get("sortBy") as SortOption | null) ?? undefined;
  const limitParam = sp.get("limit");
  const limit = limitParam ? Number(limitParam) : undefined;

  const rows = await fetchCards({ ...opts, sortBy, limit });
  return NextResponse.json(rows);
}
