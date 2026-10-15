import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { exportAccountData } from "@/lib/account.server";

/** Scarica tutti i dati dell'utente loggato come file JSON. L'id viene solo
 * dalla sessione; niente cache (dati personali). */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  const data = await exportAccountData(userId);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="cartaviva-miei-dati-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
