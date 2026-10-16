import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Elimina account",
  description: "Elimina il tuo account CartaViva e i dati collegati.",
  robots: { index: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
