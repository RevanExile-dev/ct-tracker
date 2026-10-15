/**
 * Miniature carta a misura di schermo. CardTrader offre solo due file: il
 * `preview_` da 180 px (nitido su schermi 1x) e quello intero da 734 px
 * (~150 KB); sui telefoni (DPR 2-3) il browser sceglie sempre l'intero, anche
 * se una tile ne usa 360-540. Qui riduciamo l'intero a 360 o 540 px in WebP
 * (15-30 KB): la risposta e' immutabile, quindi la CDN la tiene e la funzione
 * gira una volta sola per immagine e larghezza.
 */
export const runtime = "nodejs";

const WIDTHS = new Set([360, 540]);
// Solo `<id>/<nome file>` dell'archivio blueprint: niente URL arbitrari, quindi
// niente proxy aperto.
const SOURCE = /^\d+\/[\w.()%+-]+\.(?:jpe?g|png|webp)$/i;
const MAX_SOURCE_BYTES = 2_000_000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const file = searchParams.get("p") ?? "";
  const width = Number(searchParams.get("w"));
  if (!SOURCE.test(file) || !WIDTHS.has(width)) {
    return new Response("Parametri non validi", { status: 400 });
  }
  const original = `https://www.cardtrader.com/uploads/blueprints/image/${file}`;
  try {
    // Import dinamico dentro il try: se sharp non e' disponibile nel runtime la
    // tile riceve il redirect all'originale invece di un errore 500.
    const sharp = (await import("sharp")).default;
    // `redirect: "manual"`: un redirect dell'origine verso un altro host non viene
    // seguito (niente SSRF indiretto); il tetto di dimensione si controlla prima
    // di leggere il corpo e poi sulla lunghezza effettiva.
    const upstream = await fetch(original, { redirect: "manual", signal: AbortSignal.timeout(8000) });
    const declared = Number(upstream.headers.get("content-length") ?? 0);
    if (!upstream.ok || declared > MAX_SOURCE_BYTES) throw new Error("origine non disponibile");
    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > MAX_SOURCE_BYTES) throw new Error("origine troppo grande");
    const body = await sharp(buffer).resize({ width, withoutEnlargement: true }).webp({ quality: 70 }).toBuffer();
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      },
    });
  } catch {
    // Origine giu' o file anomalo: la tile ripiega sull'immagine intera, e non
    // si memorizza a lungo cosi' il prossimo tentativo puo' riuscire.
    return new Response(null, {
      status: 302,
      headers: { Location: original, "Cache-Control": "public, max-age=60" },
    });
  }
}
