"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Spike Three.js isolato (vedi PR #6, proposta ChatGPT del 2026-08-31 e
 * task di delega): SOLO per la card hero della pagina dettaglio, mai per
 * la griglia. Caricato dinamicamente (next/dynamic, ssr:false) e montato
 * SOLO dietro il query flag ?three=1 - il percorso di default continua a
 * usare InteractiveCard CSS esattamente come prima, zero bundle Three.js
 * scaricato in quel caso.
 *
 * Foil "vero" (non un ciclo temporale continuo): l'iridescenza dipende
 * dall'angolo di vista (termine Fresnel), come una carta foil reale che
 * cattura la luce muovendosi - non da un clock che gira all'infinito.
 * frameloop="demand" nel Canvas + invalidate() solo quando la rotazione
 * sta ancora convergendo: a scena ferma non c'e' alcun render loop attivo.
 */

const VERTEX_SHADER = `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const FRAGMENT_SHADER = `
  uniform sampler2D uMap;
  uniform float uIntensity;
  varying vec3 vNormal;
  varying vec3 vViewDir;
  varying vec2 vUv;

  void main() {
    vec4 tex = texture2D(uMap, vUv);
    float fresnel = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0), 2.2);
    vec3 iridescent = vec3(
      0.5 + 0.5 * sin(fresnel * 8.0 + vUv.x * 6.0),
      0.5 + 0.5 * sin(fresnel * 8.0 + vUv.x * 6.0 + 2.094),
      0.5 + 0.5 * sin(fresnel * 8.0 + vUv.x * 6.0 + 4.189)
    );
    vec3 color = mix(tex.rgb, tex.rgb + iridescent * fresnel * uIntensity, fresnel * uIntensity);
    gl_FragColor = vec4(color, tex.a);
  }
`;

const MAX_TILT_RAD = 0.26; // ~15 gradi, coerente con l'ampiezza gia' usata da InteractiveCard.tsx a livello "detail"

function CardPlane({
  imageUrl, isPremium, onLoadError,
}: {
  imageUrl: string;
  isPremium: boolean;
  // Bug reale trovato testando lo spike: senza un onError qui, un
  // fallimento di caricamento (rete, o l'immagine CardTrader senza header
  // CORS - richiesti da WebGL per usare un'immagine cross-origin come
  // texture, a differenza di next/image altrove nel sito che essendo un
  // <img> normale non ne ha bisogno) lasciava una carta NERA per sempre,
  // senza alcun fallback. Verificato empiricamente in questo sandbox (CDN
  // CardTrader bloccato dal proxy di rete): senza questo handler l'errore
  // di rete non veniva mai gestito.
  onLoadError: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const { invalidate, gl, size } = useThree();

  const texture = useMemo(() => {
    const tex = new THREE.TextureLoader().load(
      imageUrl,
      () => invalidate(),
      undefined,
      () => onLoadError()
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = gl.capabilities.getMaxAnisotropy();
    return tex;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  // Dispose esplicito delle risorse GPU allo smontaggio - richiesto dalla
  // documentazione Three.js, non automatico in JS (WebGLTexture/Geometry/
  // Material vivono lato GPU, il garbage collector JS non le tocca).
  useEffect(() => () => { texture.dispose(); }, [texture]);

  useEffect(() => {
    const el = gl.domElement;
    let dragging = false;
    let startX = 0;
    let startY = 0;

    function setTargetFromOffset(dx: number, dy: number) {
      const nx = Math.max(-1, Math.min(1, dx / (size.width / 2)));
      const ny = Math.max(-1, Math.min(1, dy / (size.height / 2)));
      target.current = { x: -ny * MAX_TILT_RAD, y: nx * MAX_TILT_RAD };
      invalidate();
    }

    function onPointerDown(e: PointerEvent) {
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      el.setPointerCapture(e.pointerId);
    }
    function onPointerMove(e: PointerEvent) {
      if (!dragging) return;
      setTargetFromOffset(e.clientX - startX, e.clientY - startY);
    }
    function onPointerUp(e: PointerEvent) {
      dragging = false;
      target.current = { x: 0, y: 0 };
      invalidate();
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    }

    // touch-action:none sul canvas (vedi JSX sotto) delega l'intero gesto
    // al drag qui - un tap semplice (nessun movimento) non sposta la carta,
    // coerente con la nota nell'audit: niente "tilt su tap", solo drag
    // intenzionale.
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", onPointerUp);
    el.addEventListener("pointercancel", onPointerUp);
    return () => {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerUp);
    };
  }, [gl, size, invalidate]);

  useFrame(() => {
    const c = current.current;
    const t = target.current;
    const dx = t.x - c.x;
    const dy = t.y - c.y;
    if (Math.abs(dx) < 0.0004 && Math.abs(dy) < 0.0004) return; // convergenza: nessun render successivo richiesto
    c.x += dx * 0.18;
    c.y += dy * 0.18;
    if (meshRef.current) {
      meshRef.current.rotation.x = c.x;
      meshRef.current.rotation.y = c.y;
    }
    invalidate();
  });

  return (
    <mesh ref={meshRef}>
      <planeGeometry args={[1.6, 2.24, 1, 1]} />
      <shaderMaterial
        vertexShader={VERTEX_SHADER}
        fragmentShader={FRAGMENT_SHADER}
        uniforms={{
          uMap: { value: texture },
          uIntensity: { value: isPremium ? 1 : 0.45 },
        }}
        transparent
      />
    </mesh>
  );
}

/** Rivelazione una tantum all'ingresso (equivalente 3D di .card-reveal in
 * globals.css): una sola rotazione all'apertura, mai un loop perpetuo. */
function RevealOnce({ reduceMotion }: { reduceMotion: boolean }) {
  const { invalidate } = useThree();
  const done = useRef(reduceMotion);
  useFrame(({ clock }) => {
    if (done.current) return;
    if (clock.elapsedTime > 0.7) { done.current = true; return; }
    invalidate();
  });
  return null;
}

export default function ThreeCardHero({
  imageUrl,
  alt,
  isPremium,
  reduceMotion,
  onFallback,
}: {
  imageUrl: string;
  alt: string;
  isPremium: boolean;
  reduceMotion: boolean;
  /** Chiamato per QUALUNQUE motivo per cui questo componente non puo'
   * continuare a mostrarsi (contesto WebGL perso dopo il mount - device
   * sotto pressione di memoria, driver instabile - oppure la texture non
   * e' riuscita a caricarsi, es. rete o CORS mancante sul CDN sorgente).
   * Il chiamante deve tornare al fallback CSS, questo componente non si
   * auto-ripara in nessuno dei due casi. */
  onFallback: () => void;
}) {
  return (
    <Canvas
      role="img"
      aria-label={alt}
      frameloop="demand"
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      camera={{ position: [0, 0, 3], fov: 32 }}
      style={{ touchAction: "none", cursor: "grab" }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", (e: Event) => {
          e.preventDefault();
          onFallback();
        });
      }}
    >
      <ambientLight intensity={0.9} />
      <directionalLight position={[2, 2, 3]} intensity={0.6} />
      <CardPlane imageUrl={imageUrl} isPremium={isPremium} onLoadError={onFallback} />
      <RevealOnce reduceMotion={reduceMotion} />
    </Canvas>
  );
}
