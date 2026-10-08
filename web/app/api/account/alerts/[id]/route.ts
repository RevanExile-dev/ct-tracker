import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  PriceAlertValidationError, deletePriceAlert, parsePriceAlertFields, setPriceAlertEnabled, updatePriceAlert,
} from "@/lib/account.server";

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

/** Due forme di PATCH: { enabled: boolean } attiva/disattiva manualmente
 * l'allarme (state 'armed'/'disabled'; le transizioni armed->fired->armed
 * restano del worker di valutazione), oppure tutti i campi della creazione
 * (tranne la carta) per modificarlo, vedi updatePriceAlert. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const { id } = await params;
  const alertId = parseAlertId(id);
  if (alertId === null) return NextResponse.json({ error: "Id non valido" }, { status: 400 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Payload non valido" }, { status: 400 });
  }
  const v = body as Record<string, unknown>;

  if (typeof v.enabled === "boolean") {
    const alert = await setPriceAlertEnabled(userId, alertId, v.enabled);
    if (!alert) return NextResponse.json({ error: "Allarme non trovato" }, { status: 404 });
    return NextResponse.json(alert);
  }

  const parsed = parsePriceAlertFields(v);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const alert = await updatePriceAlert(userId, alertId, parsed.fields);
    if (!alert) return NextResponse.json({ error: "Allarme non trovato" }, { status: 404 });
    return NextResponse.json(alert);
  } catch (err) {
    if (err instanceof PriceAlertValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}
