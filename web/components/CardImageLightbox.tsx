"use client";

import { useEffect } from "react";
import Image from "next/image";
import { useDialogA11y } from "@/lib/useDialogA11y";

/** Immagine della carta a tutto schermo: su telefono la miniatura della scheda e'
 * piccola (condizione, centratura, bordi non si leggono), quindi un tap la apre
 * grande. Si chiude con tap fuori, con "Chiudi" o con Escape. */
export default function CardImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const dialogRef = useDialogA11y<HTMLDivElement>();

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/85" onClick={onClose} data-testid="lightbox-backdrop" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Immagine ingrandita: ${alt}`}
        tabIndex={-1}
        className="relative flex flex-col items-center gap-3"
      >
        <div className="relative aspect-[5/7] w-[min(92vw,calc(78vh*5/7))] rounded-card overflow-hidden bg-base-surface2">
          <Image src={src} alt={alt} fill sizes="92vw" className="object-cover" priority />
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 px-6 rounded-full border border-white/20 bg-black/60 text-sm text-ink-primary active:scale-95"
        >
          Chiudi
        </button>
      </div>
    </div>
  );
}
