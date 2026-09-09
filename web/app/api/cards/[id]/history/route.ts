import { NextResponse } from "next/server";
import { fetchPriceHistory } from "@/lib/db.server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const history = await fetchPriceHistory(Number(id));
  return NextResponse.json(history);
}
