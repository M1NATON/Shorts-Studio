import React from "react";
import { Composition, staticFile } from "remotion";
import { ManifestSchema, SHORTS_SIZE, type Manifest } from "@shorts/contracts";
import { ShortsVideo } from "./ShortsVideo.js";

export const COMPOSITION_ID = "ShortsVideo";

/**
 * Размер и длительность берутся из манифеста через calculateMetadata,
 * а не хардкодятся: длительность ролика определяется озвучкой.
 */
export const RemotionRoot: React.FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={ShortsVideo as React.FC<Record<string, unknown>>}
    durationInFrames={1}
    fps={30}
    width={SHORTS_SIZE.width}
    height={SHORTS_SIZE.height}
    defaultProps={{} as Record<string, unknown>}
    calculateMetadata={async ({ props }) => {
      // В Studio пропсы пустые, поэтому манифест подхватывается из publicDir
      // (storage/manifest.json) — так превью открывает последний собранный ролик
      // без ручной передачи props. Рендер продолжает передавать манифест явно.
      const provided = (props as { manifest?: unknown }).manifest;
      const raw = provided ?? (await fetch(staticFile("manifest.json")).then((r) => r.json()));
      const manifest: Manifest = ManifestSchema.parse(raw);
      return {
        props: { manifest } as unknown as Record<string, unknown>,
        durationInFrames: manifest.totalDurationInFrames,
        fps: manifest.fps,
        width: manifest.width,
        height: manifest.height,
      };
    }}
  />
);
