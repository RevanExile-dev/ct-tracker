import { NextResponse } from "next/server";
import { fetchCardmarketReference } from "@/lib/db.server";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const blueprintId = Number(id);
  if (!Number.isInteger(blueprintId) || blueprintId < 1) {
    return NextResponse.json(null, { status: 400 });
  }
  return NextResponse.json(await fetchCardmarketReference(blueprintId));
}
