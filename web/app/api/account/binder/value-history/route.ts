import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getBinderValueHistory } from "@/lib/account.server";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  return NextResponse.json(await getBinderValueHistory(userId));
}
