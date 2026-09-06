import { NextResponse } from "next/server";
import { fetchExpansions } from "@/lib/db.server";

export async function GET() {
  return NextResponse.json(await fetchExpansions());
}
