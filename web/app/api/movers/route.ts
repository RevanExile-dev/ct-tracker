import { NextRequest, NextResponse } from "next/server";
import { fetchMoversPage } from "@/lib/db.server";
import type { MoversDirection, MoversSort } from "@/lib/types";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const direction = (sp.get("direction") as MoversDirection | null) ?? "drop";
  const rarities = sp.getAll("rarities");
  const minCentsParam = sp.get("minCents");
  const maxCentsParam = sp.get("maxCents");
  const sort = (sp.get("sort") as MoversSort | null) ?? undefined;
  const minDeltaParam = sp.get("minDeltaCents");
  const minDelta = minDeltaParam ? Number(minDeltaParam) : null;
  const pageParam = sp.get("page");
  const maxAgeParam = sp.get("maxAgeDays");
  const occasioni = sp.get("occasioni") === "1";

  const result = await fetchMoversPage({
    direction,
    rarities: rarities.length ? rarities : undefined,
    minCents: minCentsParam ? Number(minCentsParam) : null,
    maxCents: maxCentsParam ? Number(maxCentsParam) : null,
    sort,
    minDeltaCents: Number.isFinite(minDelta) ? minDelta : null,
    page: pageParam ? Number(pageParam) : undefined,
    maxAgeDays: maxAgeParam ? Number(maxAgeParam) : null,
    occasioni,
  });
  return NextResponse.json(result);
}
