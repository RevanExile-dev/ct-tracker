"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { MAX_SHARE_TITLE_LENGTH, sharePath, type ShareKind } from "@/lib/shareToken";

type Link_ = { kind: ShareKind; token: string; title: string | null; createdAt: string };

const COPY: Record<ShareKind, { what: string; intro: string; shareText: string }> = {
  binder: {
    what: "il tuo Binder",
    intro: "Manda un link a un amico: vede le tue carte con quantità e prezzi, in sola lettura.",
    shareText: "Guarda il mio Binder su CartaViva",
  },
  wishlist: {
    what: "la tua lista desideri",
    intro: "Manda un link a un amico: vede le carte che vorresti, in sola lettura (utile per un regalo).",
    shareText: "Guarda la mia lista desideri su CartaViva",
  },
};

/** Crea, copia e disattiva il link di sola lettura al binder o alla lista
 * desideri. Visibile solo con un account: il link legge i dati salvati
 * nell'account, non quelli rimasti solo sul telefono. */
export default function ShareLinkPanel({ kind }: { kind: ShareKind }) {
  const { status } = useSession();
  const [link, setLink] = useState<Link_ | null | undefined>(undefined); // undefined = sto caricando
  const [loadFailed, setLoadFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<"revoke" | "regenerate" | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const copy = COPY[kind];

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    fetch("/api/account/share")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((all: Link_[]) => { if (!cancelled) { setLink(all.find((l) => l.kind === kind) ?? null); setLoadFailed(false); } })
      .catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [status, kind]);

  // Calcolato al render: i pulsanti che lo usano compaiono solo dopo il
  // caricamento del link (solo client), quindi nessuna differenza con l'SSR.
  const canNativeShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const url = link ? `${window.location.origin}${sharePath(link.token)}` : "";

  const create = useCallback(async (keepTitle?: string | null) => {
    setBusy(true); setMessage(null); setConfirm(null);
    try {
      const res = await fetch("/api/account/share", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, title: keepTitle !== undefined ? keepTitle : title.trim() || null }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(res.status === 429 ? "Troppi tentativi, riprova tra poco." : body?.error ?? "Non riesco a creare il link.");
      setLink(body as Link_);
      setMessage({ text: "Link pronto: copialo e mandalo a chi vuoi.", error: false });
    } catch (err) {
      setMessage({ text: err instanceof Error ? err.message : "Non riesco a creare il link.", error: true });
    } finally { setBusy(false); }
  }, [kind, title]);

  async function revoke() {
    setBusy(true); setMessage(null); setConfirm(null);
    try {
      const res = await fetch(`/api/account/share?kind=${kind}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      setLink(null); setTitle("");
      setMessage({ text: "Link disattivato: chi lo ha non può più aprirlo.", error: false });
    } catch {
      setMessage({ text: "Non riesco a disattivare il link. Riprova.", error: true });
    } finally { setBusy(false); }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setMessage({ text: "Link copiato.", error: false });
    } catch {
      // Clipboard negata (HTTP, permessi): il campo e' selezionabile a mano.
      setMessage({ text: "Non riesco a copiare da solo: tieni premuto sul link qui sopra e copialo.", error: true });
    }
  }

  async function nativeShare() {
    try { await navigator.share({ title: link?.title ?? copy.shareText, text: copy.shareText, url }); } catch { /* annullato dall'utente */ }
  }

  if (status === "unauthenticated") {
    return (
      <p className="mb-5 text-xs text-ink-faint">
        Vuoi mostrare {copy.what} a un amico? <Link href="/login" className="underline hover:text-accent-bright">Accedi</Link> per creare un link da condividere.
      </p>
    );
  }
  if (status !== "authenticated") return null;

  const btn = "min-h-11 inline-flex items-center px-4 text-sm rounded-card border border-base-border bg-base-surface text-ink-primary hover:border-accent/60 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70";
  const btnPrimary = "min-h-11 inline-flex items-center px-4 text-sm rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70";

  return (
    <section className="mb-5" aria-label={`Condividi ${copy.what}`}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={btn}>
        <span aria-hidden className="mr-2">🔗</span>{link ? "Link di condivisione" : "Condividi con un link"}
      </button>
      {open && (
        <div className="mt-3 rounded-card border border-base-border bg-base-surface/70 p-4 sm:p-5 max-w-2xl">
          <p className="text-sm text-ink-muted">{copy.intro}</p>
          <p className="mt-1 text-xs text-ink-faint">
            Non mostra la tua email né quanto hai speso. Puoi disattivarlo quando vuoi.
            {kind === "binder" && " Rispecchia le carte salvate nel tuo account."}
          </p>

          {loadFailed && link === undefined && <p role="alert" className="mt-3 text-sm text-signal-down">Non riesco a controllare il link. Riprova tra poco.</p>}

          {link === null && (
            <div className="mt-4 flex flex-col sm:flex-row gap-2 sm:items-end">
              <label className="flex-1 text-xs text-ink-faint">
                Titolo (facoltativo)
                <input
                  type="text" value={title} maxLength={MAX_SHARE_TITLE_LENGTH} onChange={(e) => setTitle(e.target.value)}
                  placeholder={kind === "binder" ? "Il mio binder" : "Cosa regalarmi"}
                  className="mt-1 w-full min-h-11 rounded-card border border-base-border bg-base-surface2 px-3 text-base sm:text-sm text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                />
              </label>
              <button type="button" onClick={() => create()} disabled={busy} className={btnPrimary}>{busy ? "Creo…" : "Crea link"}</button>
            </div>
          )}

          {link && (
            <div className="mt-4">
              <label className="block text-xs text-ink-faint">
                Il tuo link{link.title ? ` · “${link.title}”` : ""}
                <input
                  type="text" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Link da condividere"
                  className="mt-1 w-full min-h-11 rounded-card border border-base-border bg-base-surface2 px-3 text-base sm:text-sm font-mono text-ink-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70"
                />
              </label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={copyLink} className={btnPrimary}>Copia link</button>
                {canNativeShare && <button type="button" onClick={nativeShare} className={btn}>Condividi…</button>}
                <a href={sharePath(link.token)} target="_blank" rel="noopener noreferrer" className={btn}>Apri anteprima</a>
              </div>
              {confirm === null ? (
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                  <button type="button" onClick={() => setConfirm("regenerate")} disabled={busy} className="min-h-11 sm:min-h-8 underline text-ink-muted hover:text-accent-bright">Crea un nuovo link</button>
                  <button type="button" onClick={() => setConfirm("revoke")} disabled={busy} className="min-h-11 sm:min-h-8 underline text-signal-down">Disattiva il link</button>
                </div>
              ) : (
                <div role="alertdialog" aria-label="Conferma" className="mt-3 rounded-card border border-signal-down/30 p-3 text-sm">
                  <p>
                    {confirm === "revoke"
                      ? "Disattivare il link? Chi lo ha non potrà più aprirlo (le anteprime già salvate da WhatsApp o dai social possono restare per un po’)."
                      : "Creare un nuovo link? Quello vecchio smette di funzionare subito."}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" onClick={confirm === "revoke" ? revoke : () => create(link.title)} disabled={busy} className={btnPrimary}>{confirm === "revoke" ? "Sì, disattiva" : "Sì, nuovo link"}</button>
                    <button type="button" onClick={() => setConfirm(null)} className={btn}>Annulla</button>
                  </div>
                </div>
              )}
            </div>
          )}

          <p role={message?.error ? "alert" : "status"} className={`mt-3 text-sm min-h-5 ${message?.error ? "text-signal-down" : "text-ink-muted"}`}>{message?.text ?? ""}</p>
        </div>
      )}
    </section>
  );
}
