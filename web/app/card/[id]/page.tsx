import type { Metadata } from "next";
import { fetchCardDetail } from "@/lib/db.server";
import { formatCents } from "@/lib/format";
import CardDetailClient from "./CardDetailClient";

// Titolo, descrizione e immagine di anteprima specifici per carta: prima
// ogni scheda aveva lo stesso titolo generico della home e la condivisione
// di un link mostrava sempre la stessa anteprima. Il contenuto della pagina
// resta renderizzato dal client (CardDetailClient): qui serve solo il
// <head>, quindi un errore del database non deve mai rompere la pagina.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const cardId = Number(id);
  if (!Number.isSafeInteger(cardId) || cardId <= 0) return {};

  let card;
  try {
    card = await fetchCardDetail(cardId);
  } catch {
    return {};
  }
  if (!card) return { title: "Carta non trovata", robots: { index: false } };

  const price = card.it_nm_zero_price_cents ?? card.best_price_cents ?? card.latest_price_cents;
  const currency = card.it_nm_zero_price_currency ?? card.best_price_currency ?? card.latest_price_currency ?? "EUR";
  const parts = [`${card.name} — ${card.expansion_name}`];
  if (card.version) parts[0] += ` (${card.version})`;
  if (price != null) parts.push(`prezzo attuale ${formatCents(price, currency)}`);
  const description = `${parts.join(", ")}. Andamento del prezzo, inserzioni attive e allarmi su CartaViva.`;
  const title = `${card.name} · ${card.expansion_name}`;
  const images = card.image_url ? [{ url: card.image_url, alt: card.name }] : undefined;

  return {
    title,
    description,
    alternates: { canonical: `/card/${cardId}` },
    openGraph: { type: "website", locale: "it_IT", siteName: "Carta Viva", title, description, ...(images ? { images } : {}) },
    twitter: { card: images ? "summary_large_image" : "summary", title, description, ...(images ? { images: [card.image_url as string] } : {}) },
  };
}

export default function CardDetailPage() {
  return <CardDetailClient />;
}
