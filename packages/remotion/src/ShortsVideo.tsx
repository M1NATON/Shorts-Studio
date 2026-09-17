import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { loadFont } from "@remotion/google-fonts/Inter";
import type { Manifest } from "@shorts/contracts";
import { Background } from "./Background.js";
import { SceneVisual } from "./scenes/index.js";
import { Subtitles } from "./Subtitles.js";
import { theme } from "./theme.js";

/**
 * Шрифт грузится через @remotion/google-fonts, а не через CSS-имя семейства: иначе
 * preview берёт локальный Inter (если он есть в системе), а headless-браузер при
 * рендере падает на fallback — и MP4 отличается от того, что видел пользователь.
 */
const { fontFamily } = loadFont("normal", {
  weights: ["400", "700", "800"],
  subsets: ["latin"],
});

/**
 * Корневая композиция. Читает ровно тот immutable manifest, который потом уйдёт
 * в export — поэтому preview и MP4 не могут разойтись.
 */
export const ShortsVideo: React.FC<{ manifest: Manifest }> = ({ manifest }) => (
  <AbsoluteFill style={{ backgroundColor: theme.canvas, fontFamily }}>
    <Background />
    {manifest.scenes.map((scene) => (
      <Sequence
        key={scene.sceneId}
        from={scene.startFrame}
        durationInFrames={scene.durationInFrames}
        name={`${scene.sceneId} · ${scene.visual.kind}`}
      >
        <Audio src={staticFile(scene.audioSrc)} />
        <SceneVisual spec={scene.visual} />
        <Subtitles words={scene.words} />
      </Sequence>
    ))}
  </AbsoluteFill>
);
