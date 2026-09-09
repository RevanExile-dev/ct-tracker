import { NextResponse } from "next/server";
import { fetchConditions } from "@/lib/db.server";

export async function GET() {
  return NextResponse.json(await fetchConditions());
}
