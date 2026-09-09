import { NextResponse } from "next/server";
import { fetchRarities } from "@/lib/db.server";

export async function GET() {
  return NextResponse.json(await fetchRarities());
}
