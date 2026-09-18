import React from "react";
import { AbsoluteFill } from "remotion";
import { FORMATS, type CaptionStyle, type WordTiming } from "@shorts/contracts";
import { Subtitles } from "./Subtitles.js";
import { FormatContext, useTheme } from "./theme.js";

/**
 * Образец стиля субтитров для выбора в UI: тот же компонент, что в рендере,
 * на полосе кадра Shorts. Показывает, как стиль выглядит на самом деле.
 */
const TEXT = "Batteries got ninety percent cheaper in ten years";
const WORD_SEC = 0.32;
export const CAPTION_SAMPLE = {
  width: 1080,
  height: 560,
  fps: 30,
  durationInFrames: Math.ceil((TEXT.split(" ").length * WORD_SEC + 0.6) * 30),
} as const;
const WORDS: WordTiming[] = TEXT.split(" ").map((text, i) => ({
  text,
  start: i * WORD_SEC,
  end: (i + 1) * WORD_SEC,
}));

export const CaptionSample: React.FC<{ captionStyle: CaptionStyle }> = ({ captionStyle }) => {
  const theme = useTheme();
  const { captions } = FORMATS.shorts;
  // Сдвиг вниз: бокс субтитров стоит по центру полосы, а не у нижнего края кадра 1920.
  const shift = captions.bottom - (CAPTION_SAMPLE.height - captions.boxHeight) / 2;
  return (
    <FormatContext.Provider value="shorts">
      <AbsoluteFill style={{ background: `radial-gradient(circle at 30% 20%, ${theme.accentSoft}, ${theme.canvas} 70%)` }}>
        <AbsoluteFill style={{ transform: `translateY(${shift}px)` }}>
          <Subtitles words={WORDS} captionStyle={captionStyle} />
        </AbsoluteFill>
      </AbsoluteFill>
    </FormatContext.Provider>
  );
};
