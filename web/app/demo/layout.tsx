import type { Metadata } from "next";
import { Figtree, JetBrains_Mono } from "next/font/google";
import "./demo.css";

const ui = Figtree({ subsets: ["latin"], variable: "--font-figtree", weight: ["400", "500", "600", "700"] });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono", weight: ["400", "500"] });

// Pagina di prova del nuovo aspetto: non deve finire nei motori di ricerca.
export const metadata: Metadata = {
  title: "Nuovo look (demo)",
  description: "Anteprima del nuovo aspetto di CartaViva.",
  robots: { index: false, follow: false },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${ui.variable} ${mono.variable}`}>{children}</div>;
}
