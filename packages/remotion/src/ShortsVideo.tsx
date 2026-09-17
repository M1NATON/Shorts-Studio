import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import type { Manifest } from "@shorts/contracts";
import { SceneVisual } from "./scenes/index.js";
import { Subtitles } from "./Subtitles.js";
import { theme } from "./theme.js";

/**
 * Корневая композиция. Читает ровно тот immutable manifest, который потом уйдёт
 * в export — поэтому preview и MP4 не могут разойтись.
 */
export const ShortsVideo: React.FC<{ manifest: Manifest }> = ({ manifest }) => (
  <AbsoluteFill style={{ backgroundColor: theme.canvas, fontFamily: "Inter, system-ui, sans-serif" }}>
    {manifest.scenes.map((scene) => (
      <Sequence
        key={scene.sceneId}
        from={scene.startFrame}
        durationInFrames={scene.durationInFrames}
        name={`${scene.sceneId} · ${scene.visual.kind}`}
      >
        <Audio src={staticFile(scene.audioSrc)} />
        <SceneVisual spec={scene.visual} />
        <Subtitles words={scene.words} approximate={scene.timingSource === "estimated"} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
