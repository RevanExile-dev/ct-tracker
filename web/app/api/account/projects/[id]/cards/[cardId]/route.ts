import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { addProjectCard, isValidProjectId, removeProjectCard } from "@/lib/projects.server";
import { limitErrorResponse } from "@/lib/accountLimitResponse";
import { isValidBlueprintId } from "@/lib/accountLimits";

type Ctx = { params: Promise<{ id: string; cardId: string }> };

export async function PUT(_req: NextRequest, { params }: Ctx) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id, cardId } = await params;
  const blueprintId = Number(cardId);
  if (!isValidProjectId(id) || !isValidBlueprintId(blueprintId)) return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
  try {
    if (!(await addProjectCard(userId, id, blueprintId))) return NextResponse.json({ error: "Progetto non trovato" }, { status: 404 });
  } catch (err) {
    const limited = limitErrorResponse(err);
    if (limited) return limited;
    throw err;
  }
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id, cardId } = await params;
  const blueprintId = Number(cardId);
  if (!isValidProjectId(id) || !isValidBlueprintId(blueprintId)) return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
  await removeProjectCard(userId, id, blueprintId);
  return NextResponse.json({ ok: true });
}
