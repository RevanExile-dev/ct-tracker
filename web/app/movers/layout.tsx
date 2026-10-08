import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Carte in movimento",
  description: "Le carte Pokémon TCG con le variazioni di prezzo più marcate dall'ultimo aggiornamento.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
