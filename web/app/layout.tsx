import type { Metadata, Viewport } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import BackToTop from "@/components/BackToTop";
import AuthSessionProvider from "@/components/AuthSessionProvider";
import AccountSync from "@/components/AccountSync";
import SiteFooter from "@/components/SiteFooter";
import { getSiteUrl } from "@/lib/siteUrl";

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
  metadataBase: new URL(getSiteUrl()),
  alternates: { canonical: "./" },
  title: { default: "CartaViva — La tua collezione TCG", template: "%s · CartaViva" },
  description: "Catalogo, prezzi, movimenti e Binder personale per le carte Pokémon TCG tracciate da CardTrader.",
  applicationName: "CartaViva",
  keywords: ["carte collezionabili", "Pokémon TCG", "CardTrader", "binder", "prezzi carte"],
  authors: [{ name: "CartaViva" }],
  creator: "CartaViva",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "CartaViva", statusBarStyle: "black" },
  openGraph: {
    type: "website",
    locale: "it_IT",
    siteName: "CartaViva",
    title: "CartaViva — La tua collezione TCG",
    description: "Segui prezzi e movimenti, crea la tua collezione e sfogliala come un vero Binder.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "CartaViva" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "CartaViva — La tua collezione TCG",
    description: "Prezzi, movimenti e Binder personale in un'unica esperienza.",
    images: ["/opengraph-image"],
  },
};

export const viewport: Viewport = { themeColor: "#0d0f12" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="font-body antialiased min-h-screen">
        <AuthSessionProvider>
          <AccountSync />
          {/* Il contenuto occupa almeno uno schermo: durante lo scheletro di
              caricamento il footer resta sotto la piega e non salta in vista
              quando arrivano i dati (CLS 0,23 su PC misurato il 14/10). */}
          <div className="min-h-screen">{children}</div>
          <SiteFooter />
          <BackToTop />
        </AuthSessionProvider>
      </body>
    </html>
  );
}
