"use client";

import { useEffect, useRef } from "react";

/** Conserva lo scroll solo per una navigazione di ritorno alla stessa URL. */
export function useScrollRestoration(scope: string, ready: boolean, currentUrl: string) {
  const restored = useRef(false);

  useEffect(() => {
    if (!ready || restored.current) return;
    restored.current = true;
    try {
      const raw = sessionStorage.getItem(`carta-viva:scroll:${scope}`);
      if (!raw) return;
      const saved = JSON.parse(raw) as { url?: string; y?: number };
      if (saved.url === currentUrl && typeof saved.y === "number") {
        requestAnimationFrame(() => window.scrollTo({ top: saved.y, behavior: "instant" }));
      }
    } catch {
      // Uno storage disabilitato non deve bloccare la navigazione.
    }
  }, [ready, scope, currentUrl]);

  useEffect(() => {
    function save() {
      try {
        sessionStorage.setItem(`carta-viva:scroll:${scope}`, JSON.stringify({
          url: currentUrl,
          y: window.scrollY,
        }));
      } catch {}
    }
    window.addEventListener("pagehide", save);
    return () => {
      save();
      window.removeEventListener("pagehide", save);
    };
  }, [scope, currentUrl]);
}
