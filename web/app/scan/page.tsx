import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";
import ScannerStudio from "@/components/scanner/ScannerStudio";
import ScannerOcrCleanup from "@/components/scanner/ScannerOcrCleanup";

export const metadata: Metadata = {
  title: "Scanner carte · CartaViva",
  description: "Riconosci carte Pokémon TCG da fotocamera o immagine e collegale al catalogo CartaViva.",
};

export default function ScanPage() {
  return (
    <main className="mx-auto w-full max-w-[1600px] px-3 sm:px-8 py-5 sm:py-8">
      <SiteHeader compact />
      <ScannerOcrCleanup />
      <ScannerStudio />
    </main>
  );
}
