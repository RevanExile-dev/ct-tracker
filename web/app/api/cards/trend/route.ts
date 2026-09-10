import { NextRequest, NextResponse } from "next/server";
import { fetchCardsTrend } from "@/lib/db.server";

export async function GET(req: NextRequest) {
  const ids = req.nextUrl.searchParams.getAll("ids").map(Number).filter(Number.isFinite);
  const daysParam = Number(req.nextUrl.searchParams.get("days"));
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 30;
  return NextResponse.json(await fetchCardsTrend(ids, days));
}
