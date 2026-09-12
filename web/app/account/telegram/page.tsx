"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { formatDateLong } from "@/lib/format";
import type { TelegramLinkStatus } from "@/lib/types";
import SiteHeader from "@/components/SiteHeader";

type LinkCode = { code: string; expiresAt: string; botUsername: string | null };

// Ogni quanto ricontrollare se il codice mostrato e' stato consumato dal
// webhook (l'utente lo manda al bot su Telegram, un'app diversa: non c'e'
// nessun evento lato browser da ascoltare) - abbastanza spesso da sembrare
// reattivo, non cosi' spesso da martellare l'endpoint per 15 minuti se
// l'utente lascia la scheda aperta senza completare il collegamento.
const POLL_INTERVAL_MS = 3000;

export default function TelegramSettingsPage() {
  const { data: session, status } = useSession();
  const [linkStatus, setLinkStatus] = useState<TelegramLinkStatus | null>(null);
  const [linkCode, setLinkCode] = useState<LinkCode | null>(null);
  const [loadingCode, setLoadingCode] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  // fetch() lanciato dentro il .then, mai un await sincrono nel corpo
  // dell'effetto (regola di lint del progetto, react-hooks/set-state-in-effect
  // - stesso pattern di web/app/lots/page.tsx).
  const fetchStatus = useCallback((): Promise<TelegramLinkStatus | null> => {
    return fetch("/api/account/telegram")
      .then((res) => (res.ok ? (res.json() as Promise<TelegramLinkStatus>) : null))
      .catch(() => null);
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchStatus().then((data) => { if (!cancelled && data) setLinkStatus(data); });
    return () => { cancelled = true; };
  }, [session, fetchStatus]);

  // Polling dello stato mentre un codice e' visibile e non ancora scaduto:
  // si ferma da solo appena il collegamento risulta completato (o quando
  // il componente viene smontato).
  useEffect(() => {
    if (!linkCode) return;
    if (new Date(linkCode.expiresAt).getTime() <= Date.now()) return;
    let cancelled = false;
    pollRef.current = window.setInterval(() => {
      fetchStatus().then((data) => {
        if (cancelled || !data) return;
        setLinkStatus(data);
        if (data.linked) {
          setLinkCode(null);
          if (pollRef.current) window.clearInterval(pollRef.current);
        }
      });
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [linkCode, fetchStatus]);

  async function generateCode() {
    setLoadingCode(true);
    setError(null);
    try {
      const res = await fetch("/api/account/telegram/link-code", { method: "POST" });
      if (!res.ok) throw new Error("Impossibile generare il codice, riprova.");
      setLinkCode(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore imprevisto");
    } finally {
      setLoadingCode(false);
    }
  }

  async function unlink() {
    setUnlinking(true);
    setError(null);
    try {
      const res = await fetch("/api/account/telegram", { method: "DELETE" });
      if (!res.ok) throw new Error("Impossibile scollegare, riprova.");
      setLinkStatus({ linked: false, linkedAt: null });
      setLinkCode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Errore imprevisto");
    } finally {
      setUnlinking(false);
    }
  }

  if (status === "loading") {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 sm:px-8 py-8 sm:py-10">
        <SiteHeader compact />
        <div className="py-20 text-center text-sm font-mono text-ink-muted animate-pulse">Carico…</div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="mx-auto w-full max-w-2xl px-4 sm:px-8 py-8 sm:py-10">
        <SiteHeader compact />
        <div className="rounded-card border border-base-border bg-base-surface/60 py-20 px-5 text-center text-ink-muted">
          <p className="mb-4">Le notifiche Telegram sono legate al tuo account: accedi per collegarle.</p>
          <Link href="/login" className="btn-lift inline-flex text-sm px-4 py-2.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60">Accedi</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-2xl px-4 sm:px-8 py-8 sm:py-10">
      <SiteHeader compact />
      <h1 className="font-display text-3xl sm:text-4xl font-bold text-ink-primary mb-1">Notifiche Telegram</h1>
      <p className="text-ink-muted mb-6">
        Collega il tuo account a una chat Telegram per ricevere lì i tuoi allarmi prezzo.
      </p>

      {error && (
        <div className="mb-4 rounded-card border border-signal-down/40 bg-signal-down/10 px-4 py-3 text-sm text-signal-down">
          {error}
        </div>
      )}

      {linkStatus?.linked ? (
        <div className="rounded-card border border-base-border bg-base-surface/70 px-5 py-4">
          <p className="text-ink-primary mb-1">✅ Chat Telegram collegata</p>
          {linkStatus.linkedAt && (
            <p className="text-xs font-mono text-ink-faint mb-4">dal {formatDateLong(linkStatus.linkedAt)}</p>
          )}
          <button
            type="button"
            onClick={unlink}
            disabled={unlinking}
            className="btn-lift text-sm px-4 py-2.5 rounded-card border border-signal-down/40 bg-signal-down/10 text-signal-down hover:border-signal-down/70 transition-colors disabled:opacity-50"
          >
            {unlinking ? "Scollego…" : "Scollega"}
          </button>
        </div>
      ) : linkCode ? (
        <div className="rounded-card border border-base-border bg-base-surface/70 px-5 py-4">
          <p className="text-ink-muted mb-3">
            Apri Telegram, cerca il bot e mandagli questo comando (valido 15 minuti):
          </p>
          <code className="block mb-4 font-mono text-lg text-accent-bright bg-base-surface2 rounded-card px-4 py-3 select-all">
            /start {linkCode.code}
          </code>
          {linkCode.botUsername && (
            <a
              href={`https://t.me/${linkCode.botUsername}?start=${linkCode.code}`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-lift inline-flex mb-4 text-sm px-4 py-2.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60"
            >
              Apri Telegram
            </a>
          )}
          <p className="text-xs font-mono text-ink-faint">
            In attesa del collegamento… aggiorno automaticamente questa pagina.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={generateCode}
          disabled={loadingCode}
          className="btn-lift text-sm px-4 py-2.5 rounded-card border border-accent/30 bg-accent/10 text-accent-bright hover:border-accent/60 transition-colors disabled:opacity-50"
        >
          {loadingCode ? "Genero il codice…" : "Collega Telegram"}
        </button>
      )}
    </main>
  );
}
