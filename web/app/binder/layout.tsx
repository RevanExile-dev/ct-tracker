import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Il mio Binder",
  description: "La tua collezione di carte Pokémon TCG: valore stimato, griglia, tabella e Binder da sfogliare.",
  robots: { index: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
