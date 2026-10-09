import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { limitErrorResponse } from "@/lib/accountLimitResponse";
import {
  PriceAlertValidationError, createPriceAlert, getPriceAlerts, parsePriceAlertFields,
} from "@/lib/account.server";
import type { PriceAlertInput } from "@/lib/types";

function parseAlertInput(body: unknown): { input: PriceAlertInput } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Payload non valido" };
  const v = body as Record<string, unknown>;

  const blueprintId = Number(v.blueprintId);
  // Number.isInteger (non solo isFinite, rilievo di review su questa PR):
  // un decimale o un valore <= 0 supererebbe comunque isFinite ma non
  // corrisponde a nessun id reale, arrivando fino all'INSERT e fallendo li'
  // con un errore Postgres non gestito (500) invece di un 400 chiaro qui.
  if (!Number.isInteger(blueprintId) || blueprintId <= 0) {
    return { error: "blueprintId mancante o non valido" };
  }

  const fields = parsePriceAlertFields(v);
  if ("error" in fields) return fields;
  return { input: { blueprintId, ...fields.fields } };
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  return NextResponse.json(await getPriceAlerts(userId));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const body = await req.json().catch(() => null);
  const parsed = parseAlertInput(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  try {
    const alert = await createPriceAlert(userId, parsed.input);
    return NextResponse.json(alert, { status: 201 });
  } catch (err) {
    if (err instanceof PriceAlertValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    const limited = limitErrorResponse(err);
    if (limited) return limited;
    throw err;
  }
}
