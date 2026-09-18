"use client";
import { useEffect, useState } from "react";
import type { VideoFormat } from "@shorts/contracts";
import { api, ApiError, type Freshness } from "@/lib/api";
import { MINUTES_OPTIONS } from "@/lib/format";

/**
 * Создание ролика. Несколько тем — по одной на строку: они встают в очередь и
 * генерируются по одной (прокси модели не держит параллельные запросы).
 */
export function CreateForm({ onCreated }: { onCreated: () => void }) {
  const [text, setText] = useState("");
  const [format, setFormat] = useState<VideoFormat>("shorts");
  const [freshness, setFreshness] = useState<Freshness | "auto">("auto");
  const [minutes, setMinutes] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Начальные значения — из Настроек → Предпочтения; здесь их можно поменять для одного запуска.
  useEffect(() => {
    api.preferences().then((p) => {
      setFormat(p.format);
      setFreshness(p.freshness);
      setMinutes(p.minutes);
    }).catch(() => undefined);
  }, []);
  const topics = text.split("\n").map((t) => t.trim()).filter((t) => t.length >= 3);

  async function submit() {
    setBusy(true);
    setError(undefined);
    try {
      await api.createProjects({
        topics,
        format,
        ...(freshness !== "auto" ? { freshness } : {}),
        ...(format === "landscape" ? { minutes } : {}),
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
          <button className={format === "shorts" ? "on" : ""} onClick={() => setFormat("shorts")}>Shorts 9:16</button>
          <button className={format === "landscape" ? "on" : ""} onClick={() => setFormat("landscape")}>Длинный 16:9</button>
        </div>
        {format === "landscape" ? (
          <label className="row small muted">
            Длина
            <select className="select" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
              {MINUTES_OPTIONS.map((m) => (
                <option key={m} value={m}>{m} мин</option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="row small muted" title="Свежесть фактов: новости и фильтр по давности. «Авто» — решает модель по теме.">
          Факты
          <select className="select" value={freshness} onChange={(e) => setFreshness(e.target.value as Freshness | "auto")}>
            <option value="auto">авто</option>
            <option value="current">свежие (новости за год)</option>
            <option value="evergreen">вечнозелёные</option>
          </select>
        </label>
        <div className="spacer" />
        {error ? <span className="error small">{error}</span> : null}
        <button className="btn primary" disabled={busy || topics.length === 0} onClick={() => void submit()}>
          {topics.length > 1 ? `Создать ${topics.length} ролика` : "Создать ролик"}
        </button>
      </div>
    </div>
  );
}
