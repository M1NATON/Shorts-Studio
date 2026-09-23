"use client";
import type { StyleChoice } from "@shorts/contracts";
import { STYLE_LABEL } from "@/lib/format";

/** Выбор стиля оформления ролика: "Авто" — решает модель, иначе конкретный стиль. */
export function StylePicker({ value, onChange }: { value: StyleChoice; onChange: (style: StyleChoice) => void }) {
  return (
    <div className="caption-picker" role="radiogroup" aria-label="Стиль оформления">
      {(Object.keys(STYLE_LABEL) as StyleChoice[]).map((style) => (
        <button
          key={style}
          type="button"
          role="radio"
          aria-checked={value === style}
          className={`caption-option${value === style ? " on" : ""}`}
          onClick={() => onChange(style)}
        >
          <span className="small">{STYLE_LABEL[style]}</span>
        </button>
      ))}
    </div>
  );
}
