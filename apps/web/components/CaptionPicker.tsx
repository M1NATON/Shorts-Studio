"use client";
import { Player } from "@remotion/player";
import type { CaptionStyle } from "@shorts/contracts";
import { CAPTION_SAMPLE, CaptionSample } from "@shorts/remotion/browser";
import { CAPTION_LABEL } from "@/lib/format";

/** Выбор стиля субтитров по живым образцам — тот же компонент, что в рендере. */
export function CaptionPicker({ value, onChange }: { value: CaptionStyle; onChange: (style: CaptionStyle) => void }) {
  return (
    <div className="caption-picker" role="radiogroup" aria-label="Стиль субтитров">
      {(Object.keys(CAPTION_LABEL) as CaptionStyle[]).map((style) => (
        <button
          key={style}
          type="button"
          role="radio"
          aria-checked={value === style}
          className={`caption-option${value === style ? " on" : ""}`}
          onClick={() => onChange(style)}
        >
          <Player
            component={CaptionSample}
            inputProps={{ captionStyle: style }}
            compositionWidth={CAPTION_SAMPLE.width}
            compositionHeight={CAPTION_SAMPLE.height}
            fps={CAPTION_SAMPLE.fps}
            durationInFrames={CAPTION_SAMPLE.durationInFrames}
            autoPlay
            loop
            controls={false}
            clickToPlay={false}
            acknowledgeRemotionLicense
            style={{ width: "100%", aspectRatio: `${CAPTION_SAMPLE.width} / ${CAPTION_SAMPLE.height}`, borderRadius: 8, pointerEvents: "none" }}
          />
          <span className="small">{CAPTION_LABEL[style]}</span>
        </button>
      ))}
    </div>
  );
}
