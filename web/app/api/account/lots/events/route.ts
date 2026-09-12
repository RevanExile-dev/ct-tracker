import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLotEvents } from "@/lib/account.server";

/** Sola lettura: gli eventi si scrivono solo come effetto collaterale di
 * create/update/delete su /api/account/lots (mai da qui). Nessun
 * consumatore UI oggi - endpoint pronto per un futuro grafico
 * apporti/rimozioni vs variazione di mercato (vedi
 * docs/binder_reserved_work_plan_2026-09-11.md). */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  return NextResponse.json(await getLotEvents(userId));
}
