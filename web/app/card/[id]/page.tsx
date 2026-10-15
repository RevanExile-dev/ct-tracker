import type { Metadata } from "next";
import { cache } from "react";
import { preload } from "react-dom";
import { fetchCardDetail } from "@/lib/db.server";
import { cardImageSources } from "@/lib/cardImage";
import { formatCents } from "@/lib/format";
import CardDetailClient from "./CardDetailClient";

// Una sola lettura per richiesta: la usano sia i metadati sia la pagina.
const getCard = cache((cardId: number) => fetchCardDetail(cardId));

// Titolo, descrizione e immagine di anteprima specifici per carta: prima
// ogni scheda aveva lo stesso titolo generico della home e la condivisione
// di un link mostrava sempre la stessa anteprima. Un errore del database
// non deve mai rompere la pagina: qui si ricade sul <head> di default.
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
    card = await getCard(cardId);
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
  // cardtrader.com risponde 301 verso www.cardtrader.com: puntare subito
  // all'host finale risparmia un salto ai crawler di WhatsApp/Telegram.
  const imageUrl = card.image_url?.replace(/^https:\/\/cardtrader\.com\//, "https://www.cardtrader.com/");
  const images = imageUrl ? [{ url: imageUrl, alt: card.name }] : undefined;

  return {
    title,
    description,
    alternates: { canonical: `/card/${cardId}` },
    openGraph: { type: "website", locale: "it_IT", siteName: "CartaViva", title, description, ...(images ? { images } : {}) },
    twitter: { card: images ? "summary_large_image" : "summary", title, description, ...(images ? { images: [imageUrl as string] } : {}) },
  };
}

// La scheda arriva gia' nell'HTML (prima il client la chiedeva alle API dopo
// l'idratazione: LCP ~4,3 s) e l'immagine grande parte in preload subito,
// con lo stesso URL che usera' <img>. In caso di errore o carta assente la
// pagina si comporta come prima: il client la cerca da solo.
export default async function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cardId = Number(id);
  let initialCard;
  if (Number.isSafeInteger(cardId) && cardId > 0) {
    try {
      initialCard = (await getCard(cardId)) ?? undefined;
    } catch {
      initialCard = undefined;
    }
  }
  if (initialCard?.image_url) preload(cardImageSources(initialCard.image_url).src, { as: "image", fetchPriority: "high" });
  return <CardDetailClient initialCard={initialCard} />;
}
