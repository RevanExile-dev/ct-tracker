import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { cleanProjectName, createProject, listProjects } from "@/lib/projects.server";
import { limitErrorResponse } from "@/lib/accountLimitResponse";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  return NextResponse.json(await listProjects(userId));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const name = cleanProjectName(body?.name);
  if (!name) return NextResponse.json({ error: "Nome non valido (da 1 a 60 caratteri)" }, { status: 400 });
  try {
    return NextResponse.json(await createProject(userId, name));
  } catch (err) {
    const limited = limitErrorResponse(err);
    if (limited) return limited;
    throw err;
  }
}
