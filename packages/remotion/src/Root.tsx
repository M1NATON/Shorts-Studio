import React from "react";
import { Composition } from "remotion";
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
    calculateMetadata={({ props }) => {
      const manifest = ManifestSchema.parse((props as { manifest: Manifest }).manifest);
      return {
        durationInFrames: manifest.totalDurationInFrames,
        fps: manifest.fps,
        width: manifest.width,
        height: manifest.height,
      };
    }}
  />
);
