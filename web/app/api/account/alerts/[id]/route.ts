import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { deletePriceAlert, setPriceAlertEnabled } from "@/lib/account.server";

function parseAlertId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id } = await params;
  const alertId = parseAlertId(id);
  if (alertId === null) return NextResponse.json({ error: "Id non valido" }, { status: 400 });
  await deletePriceAlert(userId, alertId);
  return NextResponse.json({ ok: true });
}

/** Solo il campo "enabled" (booleano): attiva/disattiva manualmente
 * l'allarme (state 'armed'/'disabled') - le altre transizioni di stato
 * (armed->fired->armed) restano di competenza del worker di valutazione
 * (sotto-parte 4c), non di questa route. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id } = await params;
  const alertId = parseAlertId(id);
  if (alertId === null) return NextResponse.json({ error: "Id non valido" }, { status: 400 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof (body as Record<string, unknown>).enabled !== "boolean") {
    return NextResponse.json({ error: "Payload non valido: atteso { enabled: boolean }" }, { status: 400 });
  }
  const alert = await setPriceAlertEnabled(userId, alertId, (body as { enabled: boolean }).enabled);
  if (!alert) return NextResponse.json({ error: "Allarme non trovato" }, { status: 404 });
  return NextResponse.json(alert);
}
