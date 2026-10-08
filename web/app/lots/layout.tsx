import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lotti",
  description: "Costo e provenienza dei tuoi acquisti di carte, con valore attuale e andamento.",
  robots: { index: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
