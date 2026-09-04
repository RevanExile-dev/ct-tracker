import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import BackToTop from "@/components/BackToTop";
import AuthSessionProvider from "@/components/AuthSessionProvider";

const display = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "700"],
});
const body = Inter({ subsets: ["latin"], variable: "--font-body" });
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://ct-tracker.vercel.app"),
  title: { default: "Carta Viva — La tua collezione TCG", template: "%s · Carta Viva" },
  description: "Catalogo, prezzi, movimenti e Binder personale per le carte Pokémon TCG tracciate da CardTrader.",
  applicationName: "Carta Viva",
  keywords: ["carte collezionabili", "Pokémon TCG", "CardTrader", "binder", "prezzi carte"],
  authors: [{ name: "Carta Viva" }],
  creator: "Carta Viva",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
  openGraph: {
    type: "website",
    locale: "it_IT",
    siteName: "Carta Viva",
    title: "Carta Viva — La tua collezione TCG",
    description: "Segui prezzi e movimenti, crea la tua collezione e sfogliala come un vero Binder.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Carta Viva" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Carta Viva — La tua collezione TCG",
    description: "Prezzi, movimenti e Binder personale in un'unica esperienza.",
    images: ["/opengraph-image"],
  },
  other: { "theme-color": "#0d0f12" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="font-body antialiased min-h-screen">
        <AuthSessionProvider>
          {children}
          <BackToTop />
        </AuthSessionProvider>
      </body>
    </html>
  );
}
