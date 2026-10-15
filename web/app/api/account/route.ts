import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { DELETE_ACCOUNT_CONFIRM, deleteAccount } from "@/lib/account.server";

/** Elimina l'account di chi chiama e tutti i suoi dati. Serve la parola di
 * conferma nel corpo: una richiesta senza (o sbagliata) non cancella nulla.
 * L'id viene sempre dalla sessione, mai dal corpo della richiesta. */
export async function DELETE(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  let body: { confirm?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    /* corpo mancante: gestito sotto come conferma sbagliata */
  }
  if (body.confirm !== DELETE_ACCOUNT_CONFIRM) {
    return NextResponse.json({ error: `Scrivi ${DELETE_ACCOUNT_CONFIRM} per confermare` }, { status: 400 });
  }
  await deleteAccount(userId);
  return NextResponse.json({ ok: true });
}
