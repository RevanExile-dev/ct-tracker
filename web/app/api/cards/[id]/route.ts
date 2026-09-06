import { NextResponse } from "next/server";
import { fetchCardDetail } from "@/lib/db.server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const card = await fetchCardDetail(Number(id));
  return NextResponse.json(card);
}
