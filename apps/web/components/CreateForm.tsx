"use client";
import { useEffect, useState } from "react";
import { Captions, Palette, Sparkles } from "lucide-react";
import type { CaptionStyle, StyleChoice } from "@shorts/contracts";
import { api, ApiError, type Preferences } from "@/lib/api";
import { CAPTION_LABEL, MINUTES_OPTIONS, plural, STYLE_LABEL } from "@/lib/format";
import { CaptionPicker } from "./CaptionPicker";
import { Popover } from "./Popover";
import { StylePicker } from "./StylePicker";

const DEFAULTS: Preferences = { format: "shorts", minutes: 3, freshness: "auto", captionStyle: "karaoke", style: "auto", research: true, exportDir: "" };

/**
 * Создание ролика одной строкой. Несколько тем — по одной на строку: они встают
 * в очередь и генерируются по одной (прокси модели не держит параллельные запросы).
 *
 * Параметры ролика запоминаются: форма открывается с последними выбранными.
 */
export function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [text, setText] = useState("");
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const topics = text.split("\n").map((t) => t.trim()).filter((t) => t.length >= 3);

  useEffect(() => {
    api.preferences().then(setPrefs).catch(() => undefined);
  }, []);

  function change(patch: Partial<Preferences>) {
    setPrefs((p) => ({ ...p, ...patch }));
    api.savePreferences(patch).catch((e: Error) => setError(`Не удалось запомнить параметры: ${e.message}`));
  }

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await api.createProjects({
        topics,
        format: prefs.format,
        captionStyle: prefs.captionStyle,
        style: prefs.style,
        ...(prefs.freshness !== "auto" ? { freshness: prefs.freshness } : {}),
        ...(prefs.format === "landscape" ? { minutes: prefs.minutes } : {}),
      });
      setText("");
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError && e.issues.length ? e.issues.map((i) => `${i.path}: ${i.message}`).join("; ") : (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const lines = text.split("\n").length;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="create-bar">
        <textarea
          className="textarea"
          aria-label="Тема ролика"
          placeholder="Тема ролика — несколько тем по строкам встанут в очередь"
          value={text}
          rows={Math.min(lines, 8)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && topics.length) void submit();
          }}
        />
        <div className="opts">
          <div className="seg" role="group" aria-label="Формат">
            <button aria-pressed={prefs.format === "shorts"} title="Shorts, вертикальный" onClick={() => change({ format: "shorts" })}>9:16</button>
            <button aria-pressed={prefs.format === "landscape"} title="Длинный, горизонтальный" onClick={() => change({ format: "landscape" })}>16:9</button>
          </div>
          {prefs.format === "landscape" ? (
            <select className="select" aria-label="Длина" value={prefs.minutes} onChange={(e) => change({ minutes: Number(e.target.value) })}>
              {MINUTES_OPTIONS.map((m) => (
                <option key={m} value={m}>{m} мин</option>
              ))}
            </select>
          ) : null}
          <select
            className="select"
            aria-label="Факты"
            title="Свежесть фактов: новости и фильтр по давности. «Авто» — решает модель по теме."
            value={prefs.freshness}
            onChange={(e) => change({ freshness: e.target.value as Preferences["freshness"] })}
          >
            <option value="auto">Факты: авто</option>
            <option value="current">Факты: свежие</option>
            <option value="evergreen">Факты: вечные</option>
          </select>
          <label className="check small" title="Искать источники в сети (Firecrawl) и сверять с ними числа. Без поиска факты — только из знаний модели.">
            <input type="checkbox" checked={prefs.research} onChange={(e) => change({ research: e.target.checked })} />
            Поиск
          </label>
          <Popover
            menuClass="menu wide"
            label={`Субтитры: ${CAPTION_LABEL[prefs.captionStyle]}`}
            button={<><Captions size={16} strokeWidth={1.75} />{CAPTION_LABEL[prefs.captionStyle]}</>}
          >
            {(close) => (
              <CaptionPicker value={prefs.captionStyle} onChange={(style: CaptionStyle) => { change({ captionStyle: style }); close(); }} />
            )}
          </Popover>
          <Popover
            menuClass="menu wide"
            label={`Стиль: ${STYLE_LABEL[prefs.style]}`}
            button={<><Palette size={16} strokeWidth={1.75} />{STYLE_LABEL[prefs.style]}</>}
          >
            {(close) => (
              <StylePicker value={prefs.style} onChange={(style: StyleChoice) => { change({ style }); close(); }} />
            )}
          </Popover>
          <button className="btn pri" disabled={busy || topics.length === 0} onClick={() => void submit()}>
            <Sparkles size={16} strokeWidth={1.75} />
            {topics.length > 1 ? `Создать ${topics.length} ${plural(topics.length, "ролик", "ролика", "роликов")}` : "Создать ролик"}
          </button>
        </div>
      </div>
      {error ? <p className="error small">{error}</p> : null}
    </div>
  );
}
