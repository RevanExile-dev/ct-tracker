import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Desideri",
  description: "Le carte che vuoi tenere d'occhio, ordinate dal ribasso di prezzo più marcato.",
  robots: { index: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
