"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { CardRow, fetchCards } from "@/lib/db";
import { HOLO_FRAGMENT_SHADER, HOLO_VERTEX_SHADER } from "@/lib/holoShader";

/**
 * Hero decorativo della home: un ventaglio di carte holo che si apre una
 * sola volta all'ingresso, con un tilt leggero dell'intero gruppo che segue
 * il mouse su desktop. Dietro lo stesso flag ?three=1 di ThreeCardHero
 * (card/[id], PR #6) - stessa disciplina incrementale, non ancora
 * "graduato" a percorso di default: caricato dinamicamente (ssr:false) e
 * montato solo se il flag e' presente, quindi zero bundle Three.js
 * scaricato per l'utente medio.
 *
 * A differenza di ThreeCardHero (che sostituisce l'unica immagine reale
 * della pagina dettaglio), qui non serve alcun fallback visivo: se il
 * componente non si accende o fallisce dopo il mount, la home resta
 * esattamente come senza questo hero (onFallback nasconde tutto, nessun
 * buco lasciato).
 *
 * Nessun listener touch: il tilt e' attivo solo dietro `(pointer: fine)`
 * (mouse reale). Un tilt-al-tap su schermi touch avrebbe lo stesso rischio
 * gia' documentato altrove nel progetto (evento sintetico che non riflette
 * il gesto touch reale) - qui e' decorativo, quindi la scelta piu' sicura
 * e' semplicemente non provarci su touch: il ventaglio resta fermo dopo la
 * rivelazione iniziale.
 */

const CARD_COUNT = 4;
const REVEAL_DURATION = 0.65; // secondi
const STAGGER = 0.09; // secondi tra la rivelazione di una carta e la successiva
const MAX_GROUP_TILT = 0.16; // rad, tilt massimo dell'intero ventaglio al passaggio del mouse

type Layout = { x: number; y: number; z: number; rotY: number; rotZ: number };

const LAYOUT: Layout[] = [
  { x: -2.05, y: -0.1, z: -0.55, rotY: -0.4, rotZ: -0.07 },
  { x: -0.7, y: 0.06, z: 0.05, rotY: -0.14, rotZ: -0.025 },
  { x: 0.7, y: 0.06, z: 0.05, rotY: 0.14, rotZ: 0.025 },
  { x: 2.05, y: -0.1, z: -0.55, rotY: 0.4, rotZ: 0.07 },
];

function HeroCard({
  imageUrl, layout, delay, onError,
}: {
  imageUrl: string;
  layout: Layout;
  delay: number;
  onError: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const { invalidate, gl } = useThree();
  const revealed = useRef(false);

  const texture = useMemo(() => {
    const tex = new THREE.TextureLoader().load(imageUrl, () => invalidate(), undefined, onError);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = gl.capabilities.getMaxAnisotropy();
    return tex;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  // Dispose esplicito delle risorse GPU allo smontaggio, come in
  // ThreeCardHero: WebGLTexture non e' toccata dal garbage collector JS.
  useEffect(() => () => { texture.dispose(); }, [texture]);

  useFrame(({ clock }) => {
    if (revealed.current) return;
    const t = Math.min(1, Math.max(0, (clock.elapsedTime - delay) / REVEAL_DURATION));
    const eased = 1 - Math.pow(1 - t, 3);
    if (meshRef.current) {
      meshRef.current.position.set(layout.x, layout.y - (1 - eased) * 0.5, layout.z);
      meshRef.current.rotation.set(0, layout.rotY * eased, layout.rotZ * eased);
      meshRef.current.scale.setScalar(0.82 + eased * 0.18);
    }
    if (t >= 1) { revealed.current = true; return; } // fine rivelazione: nessun render successivo richiesto per questa carta
    invalidate();
  });

  return (
    <mesh ref={meshRef} position={[layout.x, layout.y - 0.5, layout.z]}>
      <planeGeometry args={[1.5, 2.1, 1, 1]} />
      <shaderMaterial
        vertexShader={HOLO_VERTEX_SHADER}
        fragmentShader={HOLO_FRAGMENT_SHADER}
        uniforms={{ uMap: { value: texture }, uIntensity: { value: 0.85 } }}
        transparent
      />
    </mesh>
  );
}

/** Tilt dell'intero ventaglio verso il mouse, solo su dispositivi con
 * puntatore fine (mouse/trackpad) - niente listener touch, vedi commento
 * in testa al file. */
function ParallaxGroup({ children }: { children: React.ReactNode }) {
  const groupRef = useRef<THREE.Group>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const { invalidate } = useThree();

  useEffect(() => {
    if (!window.matchMedia("(pointer: fine)").matches) return;
    function onPointerMove(e: PointerEvent) {
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      target.current = { x: -ny * MAX_GROUP_TILT, y: nx * MAX_GROUP_TILT };
      invalidate();
    }
    window.addEventListener("pointermove", onPointerMove);
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [invalidate]);

  useFrame(() => {
    const c = current.current;
    const t = target.current;
    const dx = t.x - c.x;
    const dy = t.y - c.y;
    if (Math.abs(dx) < 0.0004 && Math.abs(dy) < 0.0004) return; // convergenza: nessun render successivo richiesto
    c.x += dx * 0.08;
    c.y += dy * 0.08;
    if (groupRef.current) {
      groupRef.current.rotation.x = c.x;
      groupRef.current.rotation.y = c.y;
    }
    invalidate();
  });

  return <group ref={groupRef}>{children}</group>;
}

export default function HomeHero3D({ onFallback }: {
  /** Chiamato per qualunque motivo il componente non possa continuare a
   * mostrarsi (contesto WebGL perso, meno di 2 carte con immagine
   * disponibile, o un errore di caricamento texture). Il chiamante deve
   * semplicemente nascondere l'hero, non c'e' un fallback CSS da mostrare
   * al suo posto. */
  onFallback: () => void;
}) {
  const [cards, setCards] = useState<CardRow[] | null>(null);
  const failedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchCards({ onlyPremium: true, sortBy: "price_desc", limit: CARD_COUNT })
      .then((rows) => {
        if (cancelled) return;
        const withImages = rows.filter((r): r is CardRow & { image_url: string } => Boolean(r.image_url));
        // Un ventaglio con una sola carta (o nessuna) non regge visivamente:
        // meglio nessun hero che uno spoglio.
        if (withImages.length < 2) { onFallback(); return; }
        setCards(withImages.slice(0, CARD_COUNT));
      })
      .catch(() => { if (!cancelled) onFallback(); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCardError() {
    if (failedRef.current) return; // un solo fallback totale, non uno per carta
    failedRef.current = true;
    onFallback();
  }

  if (!cards) return null;

  return (
    <div
      className="relative h-[220px] sm:h-[280px] -mx-5 sm:-mx-8 overflow-hidden pointer-events-none select-none"
      aria-hidden
    >
      <Canvas
        frameloop="demand"
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
        camera={{ position: [0, 0, 5], fov: 32 }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", (e: Event) => {
            e.preventDefault();
            onFallback();
          });
        }}
      >
        <ambientLight intensity={0.95} />
        <directionalLight position={[2, 3, 4]} intensity={0.55} />
        <ParallaxGroup>
          {cards.map((card, i) => (
            <HeroCard
              key={card.id}
              imageUrl={card.image_url as string}
              layout={LAYOUT[i % LAYOUT.length]}
              delay={i * STAGGER}
              onError={handleCardError}
            />
          ))}
        </ParallaxGroup>
      </Canvas>
    </div>
  );
}
