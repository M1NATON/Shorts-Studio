"use client";
import { useEffect, useState } from "react";
import type { CaptionStyle } from "@shorts/contracts";
import { api, ApiError, type Preferences } from "@/lib/api";
import { CAPTION_LABEL, MINUTES_OPTIONS } from "@/lib/format";
import { CaptionPicker } from "./CaptionPicker";

const DEFAULTS: Preferences = { format: "shorts", minutes: 3, freshness: "auto", captionStyle: "karaoke", research: true };

/**
 * Создание ролика. Несколько тем — по одной на строку: они встают в очередь и
 * генерируются по одной (прокси модели не держит параллельные запросы).
 *
 * Параметры ролика запоминаются: форма открывается с последними выбранными.
 */
export function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [text, setText] = useState("");
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);
  const [showCaptions, setShowCaptions] = useState(false);
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

  return (
    <div className="card create stack">
      <textarea
        className="textarea"
        placeholder={"Тема ролика — например: Why lithium-ion batteries got 90% cheaper\nНесколько тем — по одной на строку, они встанут в очередь"}
        value={text}
        rows={topics.length > 1 ? Math.min(topics.length + 1, 8) : 2}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && topics.length) void submit();
        }}
      />
      <div className="row">
        <div className="seg" role="group" aria-label="Формат">
          <button className={prefs.format === "shorts" ? "on" : ""} onClick={() => change({ format: "shorts" })}>Shorts 9:16</button>
          <button className={prefs.format === "landscape" ? "on" : ""} onClick={() => change({ format: "landscape" })}>Длинный 16:9</button>
        </div>
        {prefs.format === "landscape" ? (
          <label className="row small muted">
            Длина
            <select className="select" value={prefs.minutes} onChange={(e) => change({ minutes: Number(e.target.value) })}>
              {MINUTES_OPTIONS.map((m) => (
                <option key={m} value={m}>{m} мин</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="row small muted" title="Свежесть фактов: новости и фильтр по давности. «Авто» — решает модель по теме.">
          Факты
          <select className="select" value={prefs.freshness} onChange={(e) => change({ freshness: e.target.value as Preferences["freshness"] })}>
            <option value="auto">авто</option>
            <option value="current">свежие (новости за год)</option>
            <option value="evergreen">вечнозелёные</option>
          </select>
        </label>
        <label className="row small muted" title="Искать источники в сети (Firecrawl) и сверять с ними числа. Без поиска факты — только из знаний модели.">
          <input type="checkbox" checked={prefs.research} onChange={(e) => change({ research: e.target.checked })} />
          Поиск источников
        </label>
        <button className="btn" aria-expanded={showCaptions} onClick={() => setShowCaptions((v) => !v)}>
          Субтитры: {CAPTION_LABEL[prefs.captionStyle]} {showCaptions ? "▴" : "▾"}
        </button>
        <div className="spacer" />
        {error ? <span className="error small">{error}</span> : null}
        <button className="btn primary" disabled={busy || topics.length === 0} onClick={() => void submit()}>
          {topics.length > 1 ? `Создать ${topics.length} ролика` : "Создать ролик"}
        </button>
      </div>
      {showCaptions ? (
        <CaptionPicker value={prefs.captionStyle} onChange={(style: CaptionStyle) => change({ captionStyle: style })} />
      ) : null}
    </div>
  );
}
