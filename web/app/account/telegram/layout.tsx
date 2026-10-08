import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Telegram",
  description: "Collega Telegram per ricevere gli avvisi di prezzo.",
  robots: { index: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
