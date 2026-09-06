import { NextResponse } from "next/server";
import { fetchMeta } from "@/lib/db.server";

export async function GET() {
  return NextResponse.json(await fetchMeta());
}
