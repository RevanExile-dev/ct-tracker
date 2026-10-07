import { NextResponse } from "next/server";
import { fetchBlueprintImageUrl } from "@/lib/db.server";

// Lo scanner confronta la foto con le immagini del catalogo, ma CardTrader non
// manda header CORS: un'immagine caricata direttamente "sporca" il canvas e i
// pixel non sono leggibili. Questa route la ripropone dallo stesso dominio.
// Accetta solo l'id di un blueprint (l'URL viene dal database, mai dal client)
// e solo dagli host immagine gia' ammessi in next.config.js.
const ALLOWED_HOSTS = [/^(?:www\.)?cardtrader\.com$/, /\.cardtrader\.com$/, /^d2rq8wty021h6h\.cloudfront\.net$/];
const MAX_BYTES = 3 * 1024 * 1024;

function allowed(url: URL) {
  return url.protocol === "https:" && ALLOWED_HOSTS.some((pattern) => pattern.test(url.hostname));
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) return new NextResponse("id non valido", { status: 400 });

  const imageUrl = await fetchBlueprintImageUrl(id);
  if (!imageUrl) return new NextResponse("immagine non disponibile", { status: 404 });
  let target: URL;
  try {
    target = new URL(imageUrl);
  } catch {
    return new NextResponse("immagine non disponibile", { status: 404 });
  }
  if (!allowed(target)) return new NextResponse("host non ammesso", { status: 404 });

  // Redirect seguiti a mano per ricontrollare l'host a ogni passo
  // (cardtrader.com -> www.cardtrader.com).
  let response: Response | null = null;
  for (let hop = 0; hop < 3; hop += 1) {
    response = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) break;
    target = new URL(location, target);
    if (!allowed(target)) return new NextResponse("host non ammesso", { status: 404 });
  }
  if (!response?.ok) return new NextResponse("immagine non disponibile", { status: 502 });
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return new NextResponse("formato non valido", { status: 502 });
  // Rifiuta subito un file dichiarato troppo grande, senza scaricarlo.
  if (Number(response.headers.get("content-length") ?? 0) > MAX_BYTES) {
    return new NextResponse("immagine troppo grande", { status: 502 });
  }
  const body = await response.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new NextResponse("immagine troppo grande", { status: 502 });

  return new NextResponse(body, {
    headers: {
      "Content-Type": type,
      // Le immagini del catalogo non cambiano: la CDN di Vercel le serve dalla
      // cache senza rieseguire la funzione.
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
    },
  });
}
