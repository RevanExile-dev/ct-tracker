import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getFilterPreset, setFilterPreset, deleteFilterPreset } from "@/lib/account.server";
import { limitErrorResponse } from "@/lib/accountLimitResponse";
import { isValidPresetScope, isValidPresetSize } from "@/lib/accountLimits";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ scope: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { scope } = await params;
  return NextResponse.json(await getFilterPreset(userId, scope));
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ scope: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { scope } = await params;
  if (!isValidPresetScope(scope)) return NextResponse.json({ error: "Nome del filtro non valido" }, { status: 400 });
  const data = await req.json().catch(() => null);
  if (!data || typeof data !== "object" || !isValidPresetSize(data)) {
    return NextResponse.json({ error: "Payload non valido" }, { status: 400 });
  }
  try {
    return NextResponse.json(await setFilterPreset(userId, scope, data));
  } catch (err) {
    const limited = limitErrorResponse(err);
    if (limited) return limited;
    throw err;
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ scope: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { scope } = await params;
  await deleteFilterPreset(userId, scope);
  return NextResponse.json({ ok: true });
}
