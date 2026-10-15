"use client";

import { useState } from "react";
import Link from "next/link";
import { useSession, signOut } from "next-auth/react";
import SiteHeader from "@/components/SiteHeader";

const CONFIRM_WORD = "ELIMINA"; // stessa parola richiesta da /api/account (DELETE_ACCOUNT_CONFIRM)

export default function DeleteAccountPage() {
  const { data: session, status } = useSession();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typed.trim().toUpperCase() === CONFIRM_WORD;

  async function handleDelete() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: CONFIRM_WORD }),
      });
      if (!res.ok) throw new Error();
      await signOut({ callbackUrl: "/" });
    } catch {
      setError("Non sono riuscito a eliminare l'account. Non è stato cancellato nulla: riprova tra poco.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-base-bg">
      <SiteHeader />
      <main className="max-w-xl mx-auto px-4 py-8">
        <Link href="/" className="text-sm text-ink-muted hover:text-accent-bright inline-flex items-center min-h-11">
          ← Torna al catalogo
        </Link>
        <h1 className="text-2xl font-semibold text-ink-primary mt-2 mb-4">Elimina account</h1>

        {status === "loading" ? (
          <p className="text-ink-muted">Caricamento…</p>
        ) : !session ? (
          <p className="text-ink-muted">
            Per eliminare l&apos;account devi prima <Link href="/login" className="underline">accedere</Link>.
          </p>
        ) : (
          <div className="rounded-card border border-base-border bg-base-surface p-4 space-y-4">
            <p className="text-ink-primary">
              Stai per eliminare l&apos;account <strong>{session.user?.email ?? session.user?.name}</strong>.
            </p>
            <p className="text-ink-muted text-sm">
              Vengono cancellati subito e per sempre: binder, lotti, lista desideri, filtri salvati, allarmi prezzo
              e il collegamento Telegram. Non si può annullare. Il catalogo e i prezzi non cambiano.
            </p>
            <label className="block text-sm text-ink-muted" htmlFor="delete-confirm">
              Per confermare scrivi <strong className="text-ink-primary">{CONFIRM_WORD}</strong>
            </label>
            <input
              id="delete-confirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              className="w-full min-h-11 px-3 rounded-card border border-base-border bg-base-bg text-ink-primary"
            />
            {error && <p role="alert" className="text-sm text-signal-down">{error}</p>}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleDelete}
                disabled={!ready || busy}
                className="min-h-11 px-4 rounded-card border border-signal-down text-signal-down hover:bg-signal-down/10 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {busy ? "Elimino…" : "Elimina definitivamente"}
              </button>
              <Link href="/" className="min-h-11 px-4 inline-flex items-center rounded-card border border-base-border text-ink-muted">
                Annulla
              </Link>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
