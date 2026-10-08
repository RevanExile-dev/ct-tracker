import { useEffect, useRef, useState } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Comportamento da tastiera di un dialog modale: sposta il focus dentro alla
 * apertura, lo tiene intrappolato tra Tab/Shift+Tab e lo restituisce
 * all'elemento che aveva aperto il dialog alla chiusura. L'Escape resta a
 * carico del singolo dialog. Collegare il ref al contenitore con role="dialog".
 */
export function useDialogA11y<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  // Letto durante il primo render, cioe' prima che un eventuale autoFocus dei
  // campi del dialog sposti il focus: e' l'elemento a cui tornare alla chiusura.
  const [opener] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );

  useEffect(() => {
    const container = ref.current;
    if (!container) return;
        const items = () => Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));

    if (!container.contains(document.activeElement)) (items()[0] ?? container).focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const list = items();
      if (list.length === 0) {
        event.preventDefault();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container!.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container!.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (opener?.isConnected) opener.focus();
    };
  }, [opener]);

  return ref;
}
