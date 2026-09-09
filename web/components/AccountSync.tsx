"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { syncAccountData } from "@/lib/accountSync";

/** Componente invisibile, montato una sola volta nel layout root (dentro
 * AuthSessionProvider): appena la sessione risulta autenticata, unisce
 * binder/wishlist/filtri salvati locali con quelli dell'account - una sola
 * volta per login (syncedForRef), non ad ogni render ne' ad ogni cambio di
 * pagina. Da quel momento ogni modifica locale viene anche spinta sul
 * server in background dai moduli lib/binder.ts, lib/wishlist.ts,
 * lib/filterPreset.ts. */
export default function AccountSync() {
  const { data: session, status } = useSession();
  const syncedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user) return;
    // email come chiave (stabile per lo stesso account Google) invece
    // dell'id: session.user.id non e' garantito stabile tra un render e
    // l'altro finche' la sessione e' "loading" -> "authenticated", l'email
    // c'e' sempre appena autenticato.
    const userKey = session.user.email ?? session.user.name ?? "unknown";
    if (syncedForRef.current === userKey) return;
    syncedForRef.current = userKey;
    syncAccountData();
  }, [status, session]);

  return null;
}
