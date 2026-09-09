import { NextResponse } from "next/server";
import { fetchScannerCatalog } from "@/lib/db.server";

export async function GET() {
  return NextResponse.json(await fetchScannerCatalog());
}
