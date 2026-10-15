import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createShareLink, getShareLinks, revokeShareLink } from "@/lib/share.server";
import { isShareKind, normalizeShareTitle } from "@/lib/shareToken";

// Link di sola lettura al proprio binder / lista desideri. Tutte le
// operazioni riguardano SOLO l'utente della sessione: il tipo ("binder" o
// "wishlist") e' l'unico identificativo che il client puo' passare, mai un
// id utente o un token altrui.

const NO_STORE = { "Cache-Control": "no-store" };

async function currentUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401, headers: NO_STORE });
  return NextResponse.json(await getShareLinks(userId), { headers: NO_STORE });
}

/** Crea il link (o lo rigenera: il precedente smette subito di funzionare). */
export async function POST(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401, headers: NO_STORE });
  const body = (await req.json().catch(() => null)) as { kind?: unknown; title?: unknown } | null;
  if (!body || !isShareKind(body.kind)) {
    return NextResponse.json({ error: "Tipo di link non valido" }, { status: 400, headers: NO_STORE });
  }
  const title = normalizeShareTitle(body.title);
  if (title === undefined) {
    return NextResponse.json({ error: "Il titolo può avere al massimo 60 caratteri." }, { status: 400, headers: NO_STORE });
  }
  return NextResponse.json(await createShareLink(userId, body.kind, title), { headers: NO_STORE });
}

export async function DELETE(req: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Non autenticato" }, { status: 401, headers: NO_STORE });
  const kind = req.nextUrl.searchParams.get("kind");
  if (!isShareKind(kind)) {
    return NextResponse.json({ error: "Tipo di link non valido" }, { status: 400, headers: NO_STORE });
  }
  await revokeShareLink(userId, kind);
  return NextResponse.json({ ok: true }, { headers: NO_STORE });
}
