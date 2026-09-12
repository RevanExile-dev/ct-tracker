import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  PriceAlertValidationError, createPriceAlert, getPriceAlerts, isValidPriceAlertCanSellViaHub,
  isValidPriceAlertFireMode, isValidPriceAlertTargetType, isValidPriceAlertTargetValue,
  isValidRearmCooldownHours,
} from "@/lib/account.server";
import type { PriceAlertInput } from "@/lib/types";

// Stesso tetto di web/app/api/account/lots/[id]/route.ts per i campi
// stringa corti (lingua/condizione) - non un vincolo di prodotto, solo
// evitare una riga arbitrariamente grande in una colonna TEXT.
const MAX_SHORT_FIELD_LENGTH = 40;

function isNullableShortString(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0 && value.length <= MAX_SHORT_FIELD_LENGTH);
}

function parseAlertInput(body: unknown): { input: PriceAlertInput } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Payload non valido" };
  const v = body as Record<string, unknown>;

  const blueprintId = Number(v.blueprintId);
  if (!Number.isFinite(blueprintId)) return { error: "blueprintId mancante o non valido" };

  if (v.language !== undefined && !isNullableShortString(v.language)) {
    return { error: `Lingua non valida (stringa di massimo ${MAX_SHORT_FIELD_LENGTH} caratteri, oppure null per "qualunque")` };
  }
  if (v.condition !== undefined && !isNullableShortString(v.condition)) {
    return { error: `Condizione non valida (stringa di massimo ${MAX_SHORT_FIELD_LENGTH} caratteri, oppure null per "qualunque")` };
  }
  if (v.canSellViaHub !== undefined && !isValidPriceAlertCanSellViaHub(v.canSellViaHub)) {
    return { error: "canSellViaHub non valido: deve essere 0, 1, oppure null per \"indifferente\"" };
  }
  if (!isValidPriceAlertTargetType(v.targetType)) {
    return { error: "targetType non valido: deve essere 'absolute_cents' o 'percent_drop'" };
  }
  if (!isValidPriceAlertTargetValue(v.targetType, v.targetValue)) {
    return {
      error: v.targetType === "absolute_cents"
        ? "targetValue non valido: intero positivo in centesimi"
        : "targetValue non valido: intero positivo, percentuale di calo (1-99)",
    };
  }
  if (v.fireMode !== undefined && !isValidPriceAlertFireMode(v.fireMode)) {
    return { error: "fireMode non valido: deve essere 'once' o 'rearm'" };
  }
  const fireMode = (v.fireMode as PriceAlertInput["fireMode"]) ?? "once";
  if (fireMode === "rearm" && !isValidRearmCooldownHours(v.rearmCooldownHours)) {
    return { error: "rearmCooldownHours obbligatorio e valido (ore intere, >= 1) quando fireMode è 'rearm'" };
  }

  return {
    input: {
      blueprintId,
      language: (v.language as string | null | undefined) ?? undefined,
      condition: (v.condition as string | null | undefined) ?? undefined,
      canSellViaHub: (v.canSellViaHub as number | null | undefined) ?? undefined,
      targetType: v.targetType,
      targetValue: v.targetValue as number,
      fireMode,
      rearmCooldownHours: fireMode === "rearm" ? (v.rearmCooldownHours as number) : undefined,
    },
  };
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
    throw err;
  }
}
