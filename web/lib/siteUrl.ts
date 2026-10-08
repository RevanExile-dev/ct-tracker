/** URL pubblico del sito, usato per metadata, anteprime dei link
 * (og:image), sitemap e robots.
 *
 * Ordine: NEXT_PUBLIC_SITE_URL esplicito, poi il dominio di produzione che
 * Vercel espone da solo (VERCEL_PROJECT_PRODUCTION_URL, senza schema), infine
 * l'indirizzo reale di produzione. NON ripiegare su ct-tracker.vercel.app: e'
 * un altro sito ("CT Tracker Pro") e rendeva 404 l'immagine di anteprima. */
export const DEFAULT_SITE_URL = "https://ct-tracker-eight.vercel.app";

export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) return `https://${vercelProd.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return DEFAULT_SITE_URL;
}
