import { ImageResponse } from "next/og";
import { cardImageSources } from "@/lib/cardImage";
import { formatCents } from "@/lib/format";
import { getSharedCollection } from "@/lib/share.server";
import { defaultShareTitle } from "@/lib/shareToken";

// Anteprima social (og:image) di un link condiviso: titolo, numeri e fino a
// 4 carte (le piu' preziose). Le immagini delle carte vengono scaricate qui
// con un limite di tempo e di dimensione: se una non risponde si lascia
// fuori, l'anteprima esce comunque. Solo dati gia' pubblici nella pagina.

const SIZE = { width: 1200, height: 630 };
const MAX_CARDS = 4;
const IMAGE_TIMEOUT_MS = 2500;
const MAX_IMAGE_BYTES = 500_000;

async function previewDataUrl(imageUrl: string): Promise<string | null> {
  try {
    // Prima voce di srcSet = variante leggera "preview_" (180 px), basta.
    const sources = cardImageSources(imageUrl);
    const url = sources.srcSet?.split(",")[0]?.trim().split(" ")[0] ?? sources.src;
    if (!/^https:\/\/(www\.)?cardtrader\.com\//.test(url)) return null;
    // redirect: "error": un redirect (anche da un host di CardTrader) non va
    // seguito verso un indirizzo qualunque, l'immagine in piu' si salta.
    const res = await fetch(url, { signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS), redirect: "error" });
    if (!res.ok || !res.body) return null;
    const type = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
    // Satori legge solo PNG/JPEG (non WebP).
    if (type !== "image/jpeg" && type !== "image/png") return null;
    if (Number(res.headers.get("content-length") ?? 0) > MAX_IMAGE_BYTES) return null;
    // Lettura a pezzi con tetto: una risposta enorme senza content-length non
    // finisce mai tutta in memoria.
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > MAX_IMAGE_BYTES) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    if (total === 0) return null;
    return `data:${type};base64,${Buffer.concat(chunks).toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let shared;
  try {
    shared = await getSharedCollection(token);
  } catch {
    return new Response("Non disponibile", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  // Link inesistente o revocato: nessuna immagine, mai in cache.
  if (!shared) return new Response("Link non valido", { status: 404, headers: { "Cache-Control": "no-store" } });

  const top = shared.cards.filter((c) => c.imageUrl).slice(0, MAX_CARDS);
  const images = (await Promise.all(top.map((c) => previewDataUrl(c.imageUrl as string)))).filter((u): u is string => u !== null);
  const isBinder = shared.kind === "binder";
  const title = shared.title ?? defaultShareTitle(shared.kind);
  const count = shared.cards.length;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", padding: 64, background: "radial-gradient(circle at 15% 15%, #123834 0, #0d0f12 50%), radial-gradient(circle at 85% 80%, #35152f 0, #0d0f12 55%)", color: "#f5f3ee", fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1, paddingRight: 32 }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 800 }}>
            <span style={{ color: "#6ae7dc" }}>Carta</span><span style={{ color: "#ef83dc" }}>Viva</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: title.length > 28 ? 52 : 68, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }}>{title}</div>
            <div style={{ display: "flex", marginTop: 28, fontSize: 36, color: "#a8adb3" }}>
              {count === 0 ? "Ancora nessuna carta" : `${count} ${count === 1 ? "carta" : "carte"}`}
              {isBinder && shared.totalCopies !== count ? ` · ${shared.totalCopies} copie` : ""}
            </div>
            {shared.totalCents > 0 && (
              <div style={{ display: "flex", marginTop: 8, fontSize: 56, fontWeight: 800, color: "#62d8ce" }}>
                {isBinder ? "Valore stimato " : "Totale oggi "}{formatCents(shared.totalCents, shared.currency)}
              </div>
            )}
          </div>
        </div>
        {images.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", width: images.length * 150 + 150 }}>
            {images.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={src} alt="" width={250} height={349} style={{ marginLeft: i === 0 ? 0 : -100, borderRadius: 14, border: "4px solid #0d0f12", transform: `rotate(${(i - (images.length - 1) / 2) * 5}deg)`, boxShadow: "0 12px 30px #0009" }} />
            ))}
          </div>
        )}
      </div>
    ),
    { ...SIZE, headers: { "Cache-Control": "public, max-age=60, s-maxage=60" } },
  );
}
