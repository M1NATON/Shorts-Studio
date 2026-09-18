"use client";
import { useState } from "react";
import { RefreshCw, Search, Trash2 } from "lucide-react";
import type { VideoFormat } from "@shorts/contracts";
import { api, ApiError, mediaUrl, type Scene } from "@/lib/api";

const ICON = { size: 14, strokeWidth: 1.75 } as const;

type Action = "find" | "next" | "remove";
type ErrorInfo = { message: string; settingsLink?: boolean };

/** Фон сцены — фото/видео с Pexels: подбор по запросу, замена на другое, удаление. */
export function SceneMediaPanel({
  sceneId,
  media,
  format,
  onChanged,
}: {
  sceneId: string;
  media: Scene["media"];
  format: VideoFormat;
  onChanged: () => void;
}) {
  const [query, setQuery] = useState(media?.query ?? "");
  const [kind, setKind] = useState<"photo" | "video">(media?.kind ?? "photo");
  const [loading, setLoading] = useState<Action>();
  const [error, setError] = useState<ErrorInfo>();

  const run = async (action: Action, request: () => Promise<Scene & { projectId: string }>) => {
    setLoading(action);
    setError(undefined);
    try {
      await request();
      onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setError({ message: "Добавьте ключ Pexels в настройках", settingsLink: true });
      else if (e instanceof ApiError && e.status === 502) setError({ message: "Pexels не ответил, попробуйте ещё раз" });
      else setError({ message: (e as Error).message });
    } finally {
      setLoading(undefined);
    }
  };

  return (
    <div className="stack">
      <p className="section-title">Фон сцены</p>

      {media ? (
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className={`thumb${format === "landscape" ? " landscape" : ""}`} style={{ width: 96, flex: "none" }}>
            {media.kind === "photo" ? (
              <img src={mediaUrl(media.src)} alt="" />
            ) : (
              <video src={mediaUrl(media.src)} muted loop autoPlay playsInline />
            )}
          </div>
          <div className="stack" style={{ gap: 6, minWidth: 0, flex: 1 }}>
            <a className="small muted" href={media.credit.url} target="_blank" rel="noopener noreferrer">
              {media.kind === "photo" ? "Фото" : "Видео"}: {media.credit.name} · Pexels
            </a>
            <div className="row">
              <button
                className="btn sm"
                disabled={Boolean(loading)}
                onClick={() => void run("next", () => api.setSceneMedia(sceneId, { next: true }))}
              >
                <RefreshCw {...ICON} className={loading === "next" ? "spin" : undefined} />
                {loading === "next" ? "Ищу…" : "Другое"}
              </button>
              <button
                className="btn sm danger"
                disabled={Boolean(loading)}
                onClick={() => void run("remove", () => api.deleteSceneMedia(sceneId))}
              >
                <Trash2 {...ICON} />
                {loading === "remove" ? "Убираю…" : "Убрать"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <label className="stack small" htmlFor="media-query">
        Запрос для Pexels
        <div className="row">
          <input
            id="media-query"
            className="input"
            style={{ flex: 1 }}
            placeholder="что искать на Pexels"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="seg" role="radiogroup" aria-label="Тип медиа">
            <button type="button" role="radio" aria-checked={kind === "photo"} onClick={() => setKind("photo")}>Фото</button>
            <button type="button" role="radio" aria-checked={kind === "video"} onClick={() => setKind("video")}>Видео</button>
          </div>
        </div>
      </label>
      <div className="row">
        <button
          className="btn pri"
          disabled={Boolean(loading) || !query.trim()}
          onClick={() => void run("find", () => api.setSceneMedia(sceneId, { query: query.trim(), kind }))}
        >
          <Search {...ICON} />
          {loading === "find" ? "Ищу…" : "Найти"}
        </button>
      </div>

      {error ? (
        <div className="issues">
          {error.message}
          {error.settingsLink ? <> — <a href="/settings" style={{ textDecoration: "underline" }}>Настройки</a></> : null}
        </div>
      ) : null}
    </div>
  );
}
