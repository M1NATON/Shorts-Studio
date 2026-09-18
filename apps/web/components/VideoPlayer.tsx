"use client";
import { forwardRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type { Manifest } from "@shorts/contracts";
import { ShortsVideo } from "@shorts/remotion/browser";

/**
 * Превью — тот же компонент ShortsVideo, что рендерит MP4: preview = экспорт по
 * построению. Размер и длительность берутся из манифеста.
 */
export const VideoPlayer = forwardRef<
  PlayerRef,
  { manifest: Manifest; controls?: boolean; muted?: boolean; autoPlay?: boolean; loop?: boolean; initialFrame?: number }
>(function VideoPlayer({ manifest, controls = true, muted = false, autoPlay = false, loop = false, initialFrame }, ref) {
    return (
      <Player
        ref={ref}
        component={ShortsVideo as never}
        inputProps={{ manifest }}
        durationInFrames={manifest.totalDurationInFrames}
        fps={manifest.fps}
        compositionWidth={manifest.width}
        compositionHeight={manifest.height}
        controls={controls}
        initiallyMuted={muted}
        autoPlay={autoPlay}
        loop={loop}
        // Первый кадр сцены пуст: блоки ещё не вошли. Стартуем с момента, где хук уже виден.
        initialFrame={initialFrame ?? Math.min(manifest.totalDurationInFrames - 1, Math.round((manifest.scenes[0]?.durationInFrames ?? 0) * 0.6))}
        acknowledgeRemotionLicense
        style={{ width: "100%", height: "100%" }}
      />
    );
});

/** Манифест из одной сцены — для миниатюр вариантов кадра. */
export function sceneManifest(manifest: Manifest, index: number, visual?: Manifest["scenes"][number]["visual"]): Manifest {
  const scene = manifest.scenes[index]!;
  return {
    ...manifest,
    totalDurationInFrames: scene.durationInFrames,
    scenes: [{ ...scene, startFrame: 0, ...(visual ? { visual } : {}) }],
  };
}
