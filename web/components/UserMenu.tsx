"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSession, signOut } from "next-auth/react";

/** Bottone account nell'header: "Accedi" da sloggato, avatar + menu a
 * tendina (solo "Esci" per ora) da loggato. Stesso pattern minimale di
 * click-fuori-per-chiudere gia' usato altrove (FilterDropdown), qui senza
 * bisogno della complessita' di quel componente (nessuna ricerca, nessun
 * posizionamento speciale - una sola voce di menu). */
export default function UserMenu() {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleOutside(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    // Esc chiude e riporta il focus sul trigger - stesso pattern di
    // FilterDropdown, per non lasciare il focus "nel vuoto" su un menu
    // appena scomparso quando si naviga da tastiera.
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    // Un tick dopo, non subito: stesso motivo di FilterDropdown - il
    // pointerdown che ha aperto il menu non deve richiuderlo all'istante.
    const timer = window.setTimeout(() => {
      document.addEventListener("pointerdown", handleOutside);
    }, 0);
    document.addEventListener("keydown", handleKey);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  if (status === "loading") {
    return <div className="w-11 h-11 rounded-full bg-base-surface2 animate-pulse" aria-hidden />;
  }

  if (!session) {
    return (
      <Link
        href="/login"
        className="btn-lift whitespace-nowrap text-sm px-4 py-2.5 rounded-card border border-base-border bg-base-surface text-ink-muted hover:text-ink-primary hover:border-accent/60 transition-colors active:scale-95"
      >
        Accedi
      </Link>
    );
  }

  const label = session.user?.name || session.user?.email || "Account";
  const initial = label.charAt(0).toUpperCase();

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label="Menu account"
        className="w-11 h-11 rounded-full flex items-center justify-center overflow-hidden border border-base-border bg-base-surface text-ink-primary font-medium hover:border-accent/60 transition-colors active:scale-95"
      >
        {session.user?.image ? (
          <Image src={session.user.image} alt="" width={44} height={44} className="w-full h-full object-cover" />
        ) : (
          initial
        )}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+0.5rem)] z-40 min-w-48 rounded-card border border-base-border bg-base-surface shadow-card overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-base-border">
            <div className="text-sm text-ink-primary truncate">{label}</div>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => signOut()}
            className="w-full text-left px-4 py-3 text-sm text-ink-muted hover:text-signal-down hover:bg-base-surface2 transition-colors"
          >
            Esci
          </button>
        </div>
      )}
    </div>
  );
}
