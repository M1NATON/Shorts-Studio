import React, { useMemo } from "react";
import { AbsoluteFill, Audio, interpolate, Sequence, staticFile } from "remotion";
import { DEFAULT_VIDEO_THEME, type Manifest } from "@shorts/contracts";
import { Background } from "./Background.js";
import { loadThemeFont } from "./fonts.js";
import { ScenePositionContext } from "./motion.js";
import { HasSceneMediaContext } from "./presentation.js";
import { SceneMedia } from "./SceneMedia.js";
import { SceneVisual } from "./scenes/index.js";
import { Subtitles } from "./Subtitles.js";
import { FontContext, FormatContext, ThemeContext } from "./theme.js";

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
/**
 * 0→1 за первую секунду. Shorts зациклен (см. ScenePositionContext): громкость
 * постоянна до конца, иначе просадка прямо перед склейкой с повтором. Длинный
 * ролик не зациклен — музыка уходит за последние 2 с.
 */
export function musicFade(frame: number, total: number, fps: number, loop: boolean): number {
  const fadeIn = Math.max(1, Math.min(fps, Math.floor(total / 3)));
  if (loop) return interpolate(frame, [0, fadeIn], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const fadeOut = Math.max(fadeIn + 1, total - fps * 2);
  return interpolate(frame, [0, fadeIn, fadeOut, Math.max(fadeOut + 1, total)], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
}

export const ShortsVideo: React.FC<{ manifest: Manifest }> = ({ manifest }) => {
  const theme = manifest.theme ?? DEFAULT_VIDEO_THEME;
  // Shorts крутится по кругу: последняя сцена и музыка в конце не гаснут. Длинный ролик — гаснет.
  const loop = manifest.format === "shorts";
  const font = useMemo(
    () => loadThemeFont(theme.fontFamily, theme.headingWeight),
    [theme.fontFamily, theme.headingWeight],
  );

  return (
    <FormatContext.Provider value={manifest.format}>
    <ThemeContext.Provider value={theme}>
      <FontContext.Provider value={font}>
        <AbsoluteFill style={{ backgroundColor: theme.canvas, fontFamily: font.fontFamily }}>
          <Background />
          {manifest.music ? (
            // Музыка на весь ролик под голосом: вход за 1 с; в конце затухает только у длинного ролика.
            // extend — кривая громкости считается от начала ролика, а не от каждого повтора трека.
            <Audio
              src={staticFile(manifest.music.src)}
              loop
              loopVolumeCurveBehavior="extend"
              volume={(frame) => manifest.music!.volume * musicFade(frame, manifest.totalDurationInFrames, manifest.fps, loop)}
            />
          ) : null}
          {manifest.scenes.map((scene, index) => (
            <Sequence
              key={scene.sceneId}
              from={scene.startFrame}
              durationInFrames={scene.durationInFrames}
              name={`${scene.sceneId} · ${scene.visual.kind}`}
            >
              <Audio src={staticFile(scene.audioSrc)} />
              {scene.media ? <SceneMedia media={scene.media} durationInFrames={scene.durationInFrames} /> : null}
              <ScenePositionContext.Provider
                value={{ isFirst: index === 0, isLast: loop && index === manifest.scenes.length - 1 }}
              >
                <HasSceneMediaContext.Provider value={Boolean(scene.media)}>
                  <SceneVisual spec={scene.visual} />
                </HasSceneMediaContext.Provider>
              </ScenePositionContext.Provider>
              <Subtitles words={scene.words} captionStyle={manifest.captionStyle} />
            </Sequence>
          ))}
        </AbsoluteFill>
      </FontContext.Provider>
    </ThemeContext.Provider>
    </FormatContext.Provider>
  );
};
