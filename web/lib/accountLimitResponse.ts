import { NextResponse } from "next/server";
import { AccountLimitError } from "./accountLimits";

/** Risposta 409 per un tetto per account raggiunto (vedi
 * web/lib/accountLimits.ts); null per qualunque altro errore, che il
 * chiamante deve rilanciare. */
export function limitErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof AccountLimitError) {
    return NextResponse.json({ error: err.message, code: "account_limit" }, { status: 409 });
  }
  return null;
}
