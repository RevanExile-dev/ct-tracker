import { NextResponse } from "next/server";
import { fetchArtists } from "@/lib/db.server";

export async function GET() {
  return NextResponse.json(await fetchArtists());
}
