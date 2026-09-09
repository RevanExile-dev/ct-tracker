"use client";

import { useEffect, useRef } from "react";
import { clock, effect, frameLoop, init, surface } from "vgpu";
import cosmosShader from "./cosmos.wgsl";

export default function VgpuCosmos({
  pointer,
  reducedMotion,
  onStatus,
}: {
  pointer: React.RefObject<{ x: number; y: number }>;
  reducedMotion: boolean;
  onStatus: (status: "webgpu" | "fallback") => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !("gpu" in navigator)) {
      onStatus("fallback");
      return;
    }

    let disposed = false;
    let loop: { stop: () => void } | undefined;
    let gpu: Awaited<ReturnType<typeof init>> | undefined;
    let unsubscribeResize: (() => void) | undefined;

    void (async () => {
      try {
        gpu = await init();
        if (disposed) {
          gpu.dispose();
          return;
        }

        const target = surface(gpu, canvas, { dpr: [1, 1.35] });
        const cosmos = effect(gpu, cosmosShader, {
          label: "carta-viva-cosmos",
          set: {
            params: {
              resolution: target.size,
              pointer: [0.5, 0.5],
              time: 0,
              energy: reducedMotion ? 0.5 : 1,
            },
          },
        });

        unsubscribeResize = target.onResize(({ width, height }) => {
          cosmos.set({ params: { resolution: [width, height] } });
        });

        const time = clock(gpu);
        loop = frameLoop(gpu, (frame) => {
          cosmos.set({
            params: {
              time: reducedMotion ? 0 : time.time,
              pointer: [pointer.current.x, pointer.current.y],
            },
          });
          frame.pass(target, cosmos);
        }, { fps: reducedMotion ? 12 : 30 });

        onStatus("webgpu");
      } catch {
        onStatus("fallback");
      }
    })();

    return () => {
      disposed = true;
      unsubscribeResize?.();
      loop?.stop();
      gpu?.dispose();
    };
  }, [onStatus, pointer, reducedMotion]);

  return <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />;
}
