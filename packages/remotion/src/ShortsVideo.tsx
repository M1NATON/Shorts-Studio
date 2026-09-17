import React, { useMemo } from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { DEFAULT_VIDEO_THEME, type Manifest } from "@shorts/contracts";
import { Background } from "./Background.js";
import { loadThemeFont } from "./fonts.js";
import { SceneVisual } from "./scenes/index.js";
import { Subtitles } from "./Subtitles.js";
import { FontContext, ThemeContext } from "./theme.js";

/**
 * Корневая композиция. Читает ровно тот immutable manifest, который потом уйдёт
 * в export — поэтому preview и MP4 не могут разойтись.
 *
 * Тема ролика приходит из манифеста (её сгенерировала модель под тему видео) и
 * раздаётся сценам через контекст: ни один цвет и ни один вес шрифта не зашиты
 * в компонент. Шрифт грузится через @remotion/google-fonts, а не CSS-именем —
 * иначе preview взял бы локальную копию, а headless-браузер при рендере ушёл бы
 * в fallback, и MP4 отличался бы от превью.
 */
export const ShortsVideo: React.FC<{ manifest: Manifest }> = ({ manifest }) => {
  const theme = manifest.theme ?? DEFAULT_VIDEO_THEME;
  const font = useMemo(
    () => loadThemeFont(theme.fontFamily, theme.headingWeight),
    [theme.fontFamily, theme.headingWeight],
  );

  return (
    <ThemeContext.Provider value={theme}>
      <FontContext.Provider value={font}>
        <AbsoluteFill style={{ backgroundColor: theme.canvas, fontFamily: font.fontFamily }}>
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
      </FontContext.Provider>
    </ThemeContext.Provider>
  );
};
