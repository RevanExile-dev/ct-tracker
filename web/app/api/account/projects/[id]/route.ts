import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { cleanProjectName, deleteProject, isValidProjectId, renameProject } from "@/lib/projects.server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  const name = cleanProjectName(body?.name);
  if (!isValidProjectId(id) || !name) return NextResponse.json({ error: "Dati non validi" }, { status: 400 });
  if (!(await renameProject(userId, id, name))) return NextResponse.json({ error: "Progetto non trovato" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id } = await params;
  if (!isValidProjectId(id)) return NextResponse.json({ error: "Id non valido" }, { status: 400 });
  if (!(await deleteProject(userId, id))) return NextResponse.json({ error: "Progetto non trovato" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
