import { NextRequest, NextResponse } from "next/server";
import { fetchCardsSummary } from "@/lib/db.server";
import { parseCardsFilterOpts } from "@/lib/apiParams";

export async function GET(req: NextRequest) {
  const opts = parseCardsFilterOpts(req.nextUrl.searchParams);
  const summary = await fetchCardsSummary(opts);
  return NextResponse.json(summary);
}
