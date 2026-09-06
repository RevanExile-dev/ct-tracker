import { NextResponse } from "next/server";
import { fetchCatalogStats } from "@/lib/db.server";

export async function GET() {
  return NextResponse.json(await fetchCatalogStats());
}
