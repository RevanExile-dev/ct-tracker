import { NextResponse } from "next/server";
import { fetchLanguages } from "@/lib/db.server";

export async function GET() {
  return NextResponse.json(await fetchLanguages());
}
