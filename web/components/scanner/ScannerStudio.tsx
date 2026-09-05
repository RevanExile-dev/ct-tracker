"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatCents, languageFlag } from "@/lib/format";
import { getBinderIds, upsertBinderEntry } from "@/lib/binder";
import { assessQuality, cardHashes, cropRegion, detectCardRegions } from "@/lib/scanner/image";
import {
  hydrateScannerCard,
  loadScannerCatalog,
  loadVisualIndex,
  rankScannerCandidates,
} from "@/lib/scanner/catalog";
import { detectLanguage, ocrEngineNotice, recognizeText } from "@/lib/scanner/ocr";
import type {
  DetectedLanguage,
  ScanQuality,
  ScanRegion,
  ScanStatus,
  ScannerCandidate,
  ScannerCatalogEntry,
} from "@/lib/scanner/types";
import type { CardRow } from "@/lib/db";
import styles from "@/app/scan/Scanner.module.css";

type ScanItem = {
  id: string;
  cropUrl: string;
  region: ScanRegion;
  quality: ScanQuality;
  status: ScanStatus;
  ocrText: string;
  ocrConfidence: number;
  language: DetectedLanguage;
  candidates: ScannerCandidate[];
  card: CardRow | null;
  exactLanguagePrice: boolean;
  matchConfidence: number;
  error: string | null;
};

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Impossibile leggere il file."));
    reader.readAsDataURL(file);
  });
}

function statusLabel(status: ScanStatus) {
  switch (status) {
    case "queued": return "In coda";
    case "reading": return "Lettura OCR";
    case "matching": return "Match catalogo";
    case "done": return "Identificata";
    case "error": return "Da verificare";
  }
}

function confidenceTone(value: number) {
  if (value >= 0.84) return "text-signal-up border-signal-up/30 bg-signal-up/10";
  if (value >= 0.64) return "text-accent-bright border-accent/35 bg-accent/10";
  return "text-ink-muted border-base-border bg-base-surface2";
}

function qualityLabel(quality: ScanQuality) {
  if (quality.label === "glare") return "Riflesso forte";
  if (quality.label === "soft") return "Foto morbida";
  return "Qualità buona";
}

function priceFor(card: CardRow | null) {
  if (!card) return { cents: null, currency: "EUR" };
  return {
    cents:
      card.filtered_price_cents ??
      card.it_nm_zero_price_cents ??
      card.best_price_cents ??
      card.latest_price_cents ??
      null,
    currency:
      card.filtered_price_currency ??
      card.it_nm_zero_price_currency ??
      card.best_price_currency ??
      card.latest_price_currency ??
      "EUR",
  };
}

export default function ScannerStudio() {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const catalogRef = useRef<ScannerCatalogEntry[] | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [regions, setRegions] = useState<ScanRegion[]>([]);
  const [items, setItems] = useState<ScanItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [binderIds, setBinderIds] = useState<Set<number>>(new Set());
  const [manualQueries, setManualQueries] = useState<Record<string, string>>({});

  useEffect(() => {
    // requestAnimationFrame invece di un setState sincrono nel corpo
    // dell'effetto: stesso pattern gia' usato per lo stesso identico scopo
    // in app/page.tsx e app/movers/page.tsx (react-hooks/set-state-in-effect).
    const frame = requestAnimationFrame(() => setBinderIds(getBinderIds()));
    return () => cancelAnimationFrame(frame);
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraOpen(false);
  }, []);

  useEffect(() => {
    if (!cameraOpen) return;
    let cancelled = false;
    const clearFrame = requestAnimationFrame(() => setCameraError(null));
    navigator.mediaDevices?.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    }).then(async (stream) => {
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    }).catch((error) => {
      setCameraError(String(error?.message ?? "Fotocamera non disponibile."));
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(clearFrame);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [cameraOpen]);

  const updateItem = useCallback((id: string, patch: Partial<ScanItem>) => {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }, []);

  const recognizeBatch = useCallback(async (prepared: ScanItem[]) => {
    if (!prepared.length) return;
    setBusy(true);
    setGlobalError(null);
    try {
      const [catalog, visualIndex] = await Promise.all([loadScannerCatalog(), loadVisualIndex()]);
      catalogRef.current = catalog;
      let cursor = 0;
      const workerCount = Math.min(2, prepared.length);

      await Promise.all(Array.from({ length: workerCount }, async () => {
        while (cursor < prepared.length) {
          const index = cursor;
          cursor += 1;
          const item = prepared[index];
          try {
            updateItem(item.id, { status: "reading", error: null });
            let text = "";
            let ocrConfidence = 0;
            try {
              const ocr = await recognizeText(item.cropUrl);
              text = ocr.text;
              ocrConfidence = ocr.confidence;
            } catch (ocrError) {
              // Se l'indice visivo di M1 e' presente possiamo ancora tentare
              // un match; altrimenti il risultato resta correggibile a mano.
              if (!visualIndex.size) throw ocrError;
            }

            updateItem(item.id, { status: "matching", ocrText: text, ocrConfidence });
            const [scanHash, language] = await Promise.all([
              cardHashes(item.cropUrl).catch(() => null),
              Promise.resolve(detectLanguage(text)),
            ]);
            const candidates = rankScannerCandidates(text, catalog, scanHash, visualIndex, 5);
            const top = candidates[0];
            if (!top) {
              updateItem(item.id, {
                status: "error",
                language,
                candidates: [],
                matchConfidence: 0,
                error: "Match non abbastanza forte. Usa la ricerca manuale qui sotto.",
              });
              continue;
            }

            const second = candidates[1]?.score ?? 0;
            const margin = Math.max(0, top.score - second);
            const combined = Math.min(0.99, top.score * 0.72 + Math.min(1, ocrConfidence / 100) * 0.2 + Math.min(1, margin * 3) * 0.08);
            const hydrated = await hydrateScannerCard(top.id, language.code);
            updateItem(item.id, {
              status: "done",
              language,
              candidates,
              card: hydrated.card,
              exactLanguagePrice: hydrated.exactLanguagePrice,
              matchConfidence: combined,
              error: combined < 0.64 ? "Confidenza bassa: controlla le alternative prima di aggiungere al Binder." : null,
            });
          } catch (error) {
            updateItem(item.id, {
              status: "error",
              error: String(error instanceof Error ? error.message : error),
            });
          }
        }
      }));
    } catch (error) {
      setGlobalError(String(error instanceof Error ? error.message : error));
    } finally {
      setBusy(false);
    }
  }, [updateItem]);

  const prepareSource = useCallback(async (url: string) => {
    setSourceUrl(url);
    setRegions([]);
    setItems([]);
    setGlobalError(null);
    setBusy(true);
    try {
      const detected = await detectCardRegions(url);
      setRegions(detected);
      const prepared = await Promise.all(detected.map(async (region, index) => {
        const cropUrl = await cropRegion(url, region);
        const quality = await assessQuality(cropUrl);
        return {
          id: `${Date.now()}-${index}`,
          cropUrl,
          region,
          quality,
          status: "queued" as ScanStatus,
          ocrText: "",
          ocrConfidence: 0,
          language: { code: null, label: "Lingua incerta", confidence: 0 },
          candidates: [],
          card: null,
          exactLanguagePrice: false,
          matchConfidence: 0,
          error: null,
        } satisfies ScanItem;
      }));
      setItems(prepared);
      setBusy(false);
      void recognizeBatch(prepared);
    } catch (error) {
      setBusy(false);
      setGlobalError(String(error instanceof Error ? error.message : error));
    }
  }, [recognizeBatch]);

  async function acceptFile(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setGlobalError("Seleziona un'immagine JPG, PNG, HEIC/WebP supportata dal browser.");
      return;
    }
    if (file.size > 24 * 1024 * 1024) {
      setGlobalError("Immagine troppo grande: massimo 24 MB.");
      return;
    }
    try {
      const url = await fileToDataUrl(file);
      await prepareSource(url);
    } catch (error) {
      setGlobalError(String(error instanceof Error ? error.message : error));
    }
  }

  async function captureCamera() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraError("La fotocamera non è ancora pronta.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    const url = canvas.toDataURL("image/jpeg", 0.92);
    stopCamera();
    await prepareSource(url);
  }

  async function chooseCandidate(itemId: string, candidate: ScannerCandidate) {
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;
    updateItem(itemId, { status: "matching", error: null });
    try {
      const hydrated = await hydrateScannerCard(candidate.id, item.language.code);
      const existing = item.candidates.filter((entry) => entry.id !== candidate.id);
      updateItem(itemId, {
        status: "done",
        card: hydrated.card,
        exactLanguagePrice: hydrated.exactLanguagePrice,
        candidates: [candidate, ...existing],
        matchConfidence: Math.max(item.matchConfidence, candidate.score),
      });
    } catch (error) {
      updateItem(itemId, { status: "error", error: String(error instanceof Error ? error.message : error) });
    }
  }

  async function manualSearch(itemId: string) {
    const query = manualQueries[itemId]?.trim();
    if (!query) return;
    try {
      const catalog = catalogRef.current ?? await loadScannerCatalog();
      catalogRef.current = catalog;
      const candidates = rankScannerCandidates(query, catalog, null, new Map(), 8);
      updateItem(itemId, {
        candidates,
        status: candidates.length ? "done" : "error",
        error: candidates.length ? "Scegli la variante corretta dalle alternative." : "Nessun risultato. Prova con solo il nome della carta.",
      });
    } catch (error) {
      updateItem(itemId, { error: String(error instanceof Error ? error.message : error) });
    }
  }

  function addToBinder(id: number, language?: string | null) {
    if (binderIds.has(id)) return;
    // upsertBinderEntry (non toggleBinder): registra la lingua rilevata
    // dallo scanner sulla copia fisica - e' l'unico punto del sito che la
    // conosce davvero, il bottone stella nel catalogo non ha questo dato.
    const entries = upsertBinderEntry(id, { language: language ?? null });
    setBinderIds(new Set(entries.map((entry) => entry.blueprintId)));
  }

  function addAllToBinder() {
    let ids = new Set(binderIds);
    for (const item of items) {
      const id = item.card?.id;
      if (!id || ids.has(id)) continue;
      const updated = upsertBinderEntry(id, { language: item.language.code ?? null });
      ids = new Set(updated.map((entry) => entry.blueprintId));
    }
    setBinderIds(ids);
  }

  function reset() {
    stopCamera();
    setSourceUrl(null);
    setRegions([]);
    setItems([]);
    setGlobalError(null);
    setManualQueries({});
  }

  const completed = items.filter((item) => item.card).length;
  const allAdded = completed > 0 && items.filter((item) => item.card).every((item) => binderIds.has(item.card!.id));
  const progress = useMemo(() => {
    if (!items.length) return 0;
    return Math.round(items.filter((item) => item.status === "done" || item.status === "error").length / items.length * 100);
  }, [items]);

  return (
    <section className={`${styles.studio} px-4 py-5 sm:px-7 sm:py-7 lg:px-10 lg:py-9`}>
      <div className={styles.gridGlow} />
      <div className={styles.orbA} />
      <div className={styles.orbB} />

      <div className="relative z-10">
        <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-5 mb-7">
          <div className="max-w-3xl">
            <div className={`${styles.heroBadge} inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-mono uppercase tracking-[.18em] text-accent-bright mb-4`}>
              <span className={`${styles.pulseDot} w-1.5 h-1.5 rounded-full bg-accent-bright`} />
              Vision Lab · local-first
            </div>
            <h1 className="font-display text-3xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-ink-primary">
              Inquadra. <span className="text-accent-bright">Riconosci.</span> Colleziona.
            </h1>
            <p className="mt-3 text-sm sm:text-base text-ink-muted max-w-2xl leading-relaxed">
              Fotocamera o foto multipla: CartaViva isola le carte, legge nome e numero, rileva la lingua e le collega al catalogo e ai prezzi che hai già.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-mono text-ink-faint">
            <span className="rounded-full border border-base-border bg-black/15 px-3 py-1.5">12 carte / foto</span>
            <span className="rounded-full border border-base-border bg-black/15 px-3 py-1.5">OCR lazy</span>
            <span className="rounded-full border border-base-border bg-black/15 px-3 py-1.5">foto non salvate</span>
          </div>
        </div>

        {!sourceUrl && !cameraOpen && (
          <div className="grid lg:grid-cols-2 gap-4 sm:gap-5">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragActive(false);
                void acceptFile(event.dataTransfer.files?.[0]);
              }}
              className={`${styles.captureCard} ${dragActive ? styles.dropActive : ""} min-h-[260px] rounded-[24px] p-6 sm:p-8 text-left transition-all duration-300 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70`}
            >
              <div className="w-14 h-14 rounded-2xl border border-accent/25 bg-accent/10 flex items-center justify-center text-2xl shadow-glow">↥</div>
              <h2 className="font-display text-2xl font-semibold mt-7">Carica una foto</h2>
              <p className="text-sm text-ink-muted mt-2 max-w-md">Una carta o un tavolo intero. JPG, PNG, WebP e i formati che il browser riesce a leggere.</p>
              <span className="inline-flex mt-6 text-xs font-mono text-accent-bright">Trascina qui oppure scegli file →</span>
            </button>

            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className={`${styles.captureCard} min-h-[260px] rounded-[24px] p-6 sm:p-8 text-left transition-all duration-300 hover:-translate-y-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70`}
            >
              <div className="w-14 h-14 rounded-2xl border border-indigo-300/20 bg-indigo-300/10 flex items-center justify-center text-2xl">◎</div>
              <h2 className="font-display text-2xl font-semibold mt-7">Apri la fotocamera</h2>
              <p className="text-sm text-ink-muted mt-2 max-w-md">Usa la camera posteriore, allinea le carte e scatta. Il riconoscimento parte subito dopo la cattura.</p>
              <span className="inline-flex mt-6 text-xs font-mono text-accent-bright">Camera live →</span>
            </button>
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="image/*"
              capture={undefined}
              onChange={(event) => void acceptFile(event.target.files?.[0])}
            />
          </div>
        )}

        {cameraOpen && (
          <div className="max-w-4xl mx-auto">
            <div className={`${styles.cameraFrame} aspect-[4/3] sm:aspect-video`}>
              <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
              <span className={`${styles.corner} ${styles.cornerTL}`} />
              <span className={`${styles.corner} ${styles.cornerTR}`} />
              <span className={`${styles.corner} ${styles.cornerBL}`} />
              <span className={`${styles.corner} ${styles.cornerBR}`} />
              <div className="absolute z-10 bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-black/45 backdrop-blur-xl px-4 py-2 text-xs text-white/80 whitespace-nowrap">
                Lascia un po&apos; di spazio tra le carte
              </div>
            </div>
            {cameraError && <div className="mt-3 text-sm text-signal-down">{cameraError}</div>}
            <div className="mt-5 flex items-center justify-center gap-3">
              <button type="button" onClick={stopCamera} className="px-5 py-3 rounded-xl border border-base-border bg-base-surface text-sm text-ink-muted hover:text-ink-primary">Annulla</button>
              <button type="button" onClick={() => void captureCamera()} className={`${styles.actionPrimary} px-7 py-3 rounded-xl bg-accent text-black font-semibold text-sm active:scale-95 transition-transform`}>Scatta e riconosci</button>
            </div>
          </div>
        )}

        {sourceUrl && (
          <>
            <div className="grid xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,.92fr)] gap-5 items-start">
              <div>
                <div className={`${styles.previewWrap} min-h-[280px] flex items-center justify-center`}>
                  <Image src={sourceUrl} alt="Foto da analizzare" width={1400} height={1000} unoptimized className="w-full h-auto max-h-[620px] object-contain" />
                  {regions.map((region) => (
                    <span
                      key={region.id}
                      className={styles.region}
                      style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }}
                    />
                  ))}
                  {busy && <div className="absolute inset-x-0 bottom-0 h-1.5 bg-black/30"><div className="h-full bg-accent transition-[width] duration-500" style={{ width: `${Math.max(8, progress)}%` }} /></div>}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
                  <div className="text-xs font-mono text-ink-faint">
                    {regions.length === 1 && regions[0]?.fallback ? "Nessun bordo sicuro: analizzo l'intera foto" : `${regions.length} ${regions.length === 1 ? "carta rilevata" : "carte rilevate"}`}
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => inputRef.current?.click()} className="px-4 py-2.5 rounded-xl border border-base-border bg-base-surface text-xs text-ink-muted hover:text-ink-primary">Cambia foto</button>
                    <button type="button" disabled={busy} onClick={() => void recognizeBatch(items.map((item) => ({ ...item, status: "queued", error: null })))} className="px-4 py-2.5 rounded-xl border border-accent/35 bg-accent/10 text-xs text-accent-bright disabled:opacity-40">Rianalizza</button>
                    <button type="button" onClick={reset} className="px-4 py-2.5 rounded-xl border border-base-border text-xs text-ink-faint">Reset</button>
                  </div>
                </div>
                <input ref={inputRef} className="sr-only" type="file" accept="image/*" onChange={(event) => void acceptFile(event.target.files?.[0])} />
              </div>

              <aside className="rounded-[22px] border border-base-border bg-black/15 backdrop-blur p-5 sm:p-6 xl:sticky xl:top-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-mono uppercase tracking-[.18em] text-ink-faint">Sessione</div>
                    <div className="font-display text-2xl font-semibold mt-1">{completed}/{items.length || regions.length} identificate</div>
                  </div>
                  <div className="w-12 h-12 rounded-full border border-accent/25 bg-accent/10 grid place-items-center font-mono text-xs text-accent-bright">{progress}%</div>
                </div>
                <div className={`${styles.progressRail} h-1.5 rounded-full mt-5`} />
                <div className="grid grid-cols-3 gap-2 mt-5">
                  <div className="rounded-xl border border-base-border bg-white/[.025] p-3"><div className="text-[10px] font-mono text-ink-faint">DETECT</div><div className="text-sm mt-1">Canvas</div></div>
                  <div className="rounded-xl border border-base-border bg-white/[.025] p-3"><div className="text-[10px] font-mono text-ink-faint">READ</div><div className="text-sm mt-1">OCR</div></div>
                  <div className="rounded-xl border border-base-border bg-white/[.025] p-3"><div className="text-[10px] font-mono text-ink-faint">MATCH</div><div className="text-sm mt-1">Catalogo</div></div>
                </div>
                <p className="text-xs text-ink-faint leading-relaxed mt-5">{ocrEngineNotice()}</p>
                {completed > 0 && (
                  <button type="button" disabled={allAdded} onClick={addAllToBinder} className={`${styles.actionPrimary} mt-5 w-full min-h-12 rounded-xl bg-accent text-black font-semibold text-sm disabled:opacity-50 disabled:cursor-default`}>
                    {allAdded ? "Tutte già nel Binder ✓" : `Aggiungi ${completed > 1 ? "tutte" : "al Binder"}`}
                  </button>
                )}
              </aside>
            </div>

            {globalError && <div className="mt-5 rounded-xl border border-signal-down/30 bg-signal-down/5 p-4 text-sm text-signal-down">{globalError}</div>}

            <div className="mt-7 grid gap-4">
              {items.map((item, index) => {
                const selected = item.card;
                const price = priceFor(selected);
                const inBinder = selected ? binderIds.has(selected.id) : false;
                return (
                  <article key={item.id} className={`${styles.resultCard} rounded-[22px] p-4 sm:p-5`} style={{ animationDelay: `${Math.min(index, 8) * 55}ms` }}>
                    <div className="grid sm:grid-cols-[150px_minmax(0,1fr)] lg:grid-cols-[180px_minmax(0,1fr)_auto] gap-4 sm:gap-5 items-start">
                      <div className={styles.imageShell}>
                        <Image
                          src={selected?.image_url || item.cropUrl}
                          alt={selected?.name || "Carta scansionata"}
                          width={360}
                          height={504}
                          unoptimized={!selected?.image_url}
                          className="w-full aspect-[5/7] object-cover bg-base-surface2"
                        />
                        {selected?.image_url && (
                          <div className="absolute bottom-2 right-2 w-12 sm:w-14 rounded-md overflow-hidden border border-white/20 shadow-xl">
                            <Image src={item.cropUrl} alt="Scansione originale" width={90} height={126} unoptimized className="w-full aspect-[5/7] object-cover" />
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[10px] font-mono uppercase tracking-wider rounded-full border border-base-border px-2.5 py-1 text-ink-faint">#{index + 1}</span>
                          <span className={`text-[10px] font-mono uppercase tracking-wider rounded-full border px-2.5 py-1 ${item.status === "done" ? "border-accent/30 bg-accent/10 text-accent-bright" : "border-base-border text-ink-muted"}`}>{statusLabel(item.status)}</span>
                          {item.status === "done" && (
                            <span className={`text-[10px] font-mono rounded-full border px-2.5 py-1 ${confidenceTone(item.matchConfidence)}`}>{Math.round(item.matchConfidence * 100)}% match</span>
                          )}
                          <span className="text-[10px] font-mono rounded-full border border-base-border px-2.5 py-1 text-ink-faint">{qualityLabel(item.quality)}</span>
                        </div>

                        {selected ? (
                          <>
                            <div className="text-xs font-mono text-ink-faint mt-4">{selected.expansion_name}</div>
                            <h3 className="font-display text-2xl sm:text-3xl font-semibold mt-1 text-ink-primary">{selected.name}</h3>
                            <div className="flex flex-wrap items-center gap-3 mt-3">
                              <span className="text-sm text-ink-muted">{item.language.code ? `${languageFlag(item.language.code)} ${item.language.label}` : item.language.label}</span>
                              {selected.rarity && <span className="text-xs rounded-full border border-base-border bg-base-surface2 px-2.5 py-1 text-ink-muted">{selected.rarity}</span>}
                            </div>
                            <div className="flex flex-wrap items-end gap-x-4 gap-y-1 mt-5">
                              <div className="font-mono text-2xl text-ink-primary">{formatCents(price.cents, price.currency)}</div>
                              <div className="text-[11px] text-ink-faint pb-1">{item.exactLanguagePrice && item.language.code ? `offerta ${item.language.code.toUpperCase()} disponibile` : "miglior riferimento disponibile"}</div>
                            </div>
                          </>
                        ) : (
                          <div className="mt-5">
                            <h3 className="font-display text-xl font-semibold">Sto cercando la carta…</h3>
                            <p className="text-sm text-ink-muted mt-2">Nome, numero, lingua e segnali visivi vengono combinati prima del match.</p>
                          </div>
                        )}

                        {(item.status === "reading" || item.status === "matching") && <div className={`${styles.progressRail} h-1 rounded-full mt-5`} />}
                        {item.error && <div className="mt-4 text-xs text-accent-bright leading-relaxed">{item.error}</div>}

                        {item.candidates.length > 1 && (
                          <div className="mt-5">
                            <div className="text-[10px] font-mono uppercase tracking-wider text-ink-faint mb-2">Alternative</div>
                            <div className="flex flex-wrap gap-2">
                              {item.candidates.slice(0, 4).map((candidate) => (
                                <button key={candidate.id} type="button" onClick={() => void chooseCandidate(item.id, candidate)} className={`rounded-lg border px-3 py-2 text-left text-xs transition-colors ${selected?.id === candidate.id ? "border-accent/45 bg-accent/10 text-accent-bright" : "border-base-border bg-base-surface2 text-ink-muted hover:text-ink-primary"}`}>
                                  <span className="font-medium">{candidate.name}</span><span className="ml-1 text-ink-faint">· {candidate.expansion_code}</span>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {(item.status === "error" || item.matchConfidence < 0.64) && (
                          <div className="mt-5 flex flex-col sm:flex-row gap-2 max-w-xl">
                            <input
                              value={manualQueries[item.id] ?? ""}
                              onChange={(event) => setManualQueries((current) => ({ ...current, [item.id]: event.target.value }))}
                              onKeyDown={(event) => { if (event.key === "Enter") void manualSearch(item.id); }}
                              placeholder="Correggi: es. Latios 203/191"
                              className="min-h-11 flex-1 rounded-xl border border-base-border bg-black/20 px-3 text-sm outline-none focus:border-accent/50"
                            />
                            <button type="button" onClick={() => void manualSearch(item.id)} className="min-h-11 rounded-xl border border-accent/35 bg-accent/10 px-4 text-xs font-medium text-accent-bright">Cerca</button>
                          </div>
                        )}
                      </div>

                      {selected && (
                        <div className="flex sm:col-start-2 lg:col-start-auto lg:flex-col gap-2 lg:min-w-[156px]">
                          <Link href={`/card/${selected.id}?from=${encodeURIComponent("/scan")}`} className="flex-1 min-h-11 inline-flex items-center justify-center rounded-xl border border-base-border bg-base-surface px-4 text-xs text-ink-muted hover:text-ink-primary hover:border-accent/40 transition-colors">Apri carta</Link>
                          <button type="button" disabled={inBinder} onClick={() => addToBinder(selected.id, item.language.code)} className={`${styles.actionPrimary} flex-1 min-h-11 rounded-xl bg-accent px-4 text-xs font-semibold text-black disabled:opacity-55 disabled:cursor-default`}>{inBinder ? "Nel Binder ✓" : "＋ Binder"}</button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
