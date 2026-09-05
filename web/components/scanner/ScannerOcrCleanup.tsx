"use client";

import { useEffect } from "react";
import { terminateOcr } from "@/lib/scanner/ocr";

/**
 * Tesseract mantiene un worker WASM relativamente pesante. La pagina Scanner
 * lo riusa durante la sessione, ma quando si naviga altrove lo terminiamo in
 * cleanup cosi' memoria/worker non restano vivi nel resto di CartaViva.
 */
export default function ScannerOcrCleanup() {
  useEffect(() => {
    return () => {
      void terminateOcr();
    };
  }, []);

  return null;
}
