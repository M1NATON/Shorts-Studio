"use client";
import { useState } from "react";
import { Copy, RotateCcw, Sparkles } from "lucide-react";
import { PublishMetaSchema, type PublishMeta } from "@shorts/contracts";
import { api, ApiError } from "@/lib/api";

const ICON = { size: 14, strokeWidth: 1.75 } as const;

function describeError(e: unknown): string {
  return e instanceof ApiError && e.issues.length ? e.issues.map((i) => `${i.path}: ${i.message}`).join("; ") : (e as Error).message;
}

/** Кнопка копирования в буфер с подтверждением, как в ExportMenu. */
function CopyButton({ text, children }: { text: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // буфер обмена недоступен (нет разрешения/не https) — поле можно выделить и скопировать вручную
    }
  };
  return (
    <button type="button" className="btn ghost sm" onClick={() => void copy()} aria-label={children}>
      <Copy {...ICON} />
      <span role="status">{copied ? "Скопировано" : children}</span>
    </button>
  );
}

/** Название, описание и хэштеги для YouTube: правка руками или пересборка ИИ по текущим сценам. */
export function PublishPanel({ projectId, value, onChanged }: { projectId: string; value: PublishMeta | null; onChanged: () => void }) {
  const [saved, setSaved] = useState(value);
  const [title, setTitle] = useState(value?.title ?? "");
  const [description, setDescription] = useState(value?.description ?? "");
  const [hashtagsText, setHashtagsText] = useState(value?.hashtags.join(" ") ?? "");
  const [thumbnailPrompt, setThumbnailPrompt] = useState(value?.thumbnailPrompt ?? "");
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string>();

  const dirty = saved
    ? title !== saved.title || description !== saved.description || hashtagsText !== saved.hashtags.join(" ") || thumbnailPrompt !== (saved.thumbnailPrompt ?? "")
    : Boolean(title || description || hashtagsText || thumbnailPrompt);

  const apply = (meta: PublishMeta) => {
    setSaved(meta);
    setTitle(meta.title);
    setDescription(meta.description);
    setHashtagsText(meta.hashtags.join(" "));
    setThumbnailPrompt(meta.thumbnailPrompt ?? "");
  };

  const generate = async () => {
    if (dirty && !window.confirm("Есть несохранённые правки — сгенерировать заново и потерять их?")) return;
    setGenerating(true);
    setError(undefined);
    try {
      apply(await api.regeneratePublish(projectId));
      onChanged();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    const candidate = {
      title: title.trim(),
      description: description.trim(),
      hashtags: hashtagsText.trim().split(/\s+/).filter(Boolean),
      ...(thumbnailPrompt.trim() ? { thumbnailPrompt: thumbnailPrompt.trim() } : {}),
    };
    const parsed = PublishMetaSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join("; "));
      return;
    }
    setSaving(true);
    setError(undefined);
    try {
      await api.setPublish(projectId, parsed.data);
      apply(parsed.data);
      onChanged();
    } catch (e) {
      setError(describeError(e));
    } finally {
      setSaving(false);
    }
  };

  if (!saved) {
    return (
      <div className="stack">
        <p className="small muted">Название и описание ещё не сгенерированы.</p>
        {error ? <div className="issues">{error}</div> : null}
        <button className="btn pri" disabled={generating} onClick={() => void generate()}>
          <Sparkles {...ICON} />{generating ? "Генерирую…" : "Сгенерировать"}
        </button>
      </div>
    );
  }

  const titleWarn = title.length > 60;
  const allText = `${title}\n\n${description}\n\n${hashtagsText}`;

  return (
    <div className="stack">
      <div className="stack" style={{ gap: 4 }}>
        <label className="section-title" htmlFor="pub-title">Название</label>
        <div className="row">
          <input id="pub-title" className="input" style={{ flex: 1 }} maxLength={100} disabled={generating} value={title} onChange={(e) => setTitle(e.target.value)} />
          <CopyButton text={title}>Копировать</CopyButton>
        </div>
        <p className={`small ${titleWarn ? "warn" : "muted"}`}><span className="mono">{title.length}/100</span>{titleWarn ? " · длинное, в выдаче обрежется" : ""}</p>
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <label className="section-title" htmlFor="pub-description">Описание</label>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <textarea id="pub-description" className="textarea" rows={8} maxLength={3000} disabled={generating} value={description} onChange={(e) => setDescription(e.target.value)} />
          <CopyButton text={description}>Копировать</CopyButton>
        </div>
        <p className="small muted"><span className="mono">{description.length}/3000</span></p>
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <label className="section-title" htmlFor="pub-hashtags">Хэштеги</label>
        <div className="row">
          <input id="pub-hashtags" className="input" style={{ flex: 1 }} disabled={generating} value={hashtagsText} onChange={(e) => setHashtagsText(e.target.value)} />
          <CopyButton text={hashtagsText}>Копировать</CopyButton>
        </div>
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <label className="section-title" htmlFor="pub-thumbnail">Промпт для обложки</label>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <textarea
            id="pub-thumbnail"
            className="textarea"
            rows={5}
            maxLength={2000}
            disabled={generating}
            placeholder="Появится после «Сгенерировать заново»"
            value={thumbnailPrompt}
            onChange={(e) => setThumbnailPrompt(e.target.value)}
          />
          <CopyButton text={thumbnailPrompt}>Копировать</CopyButton>
        </div>
        <p className="small muted">Вставьте в генератор картинок (Midjourney, Nano Banana, DALL·E и т.п.).</p>
      </div>

      {error ? <div className="issues">{error}</div> : null}

      <div className="row">
        <button className="btn pri" disabled={!dirty || saving || generating} onClick={() => void save()}>
          {saving ? "Сохраняю…" : "Сохранить"}
        </button>
        <button className="btn" disabled={saving || generating} onClick={() => void generate()}>
          <RotateCcw {...ICON} />{generating ? "Генерирую…" : "Сгенерировать заново"}
        </button>
        <div className="spacer" />
        <CopyButton text={allText}>Скопировать всё</CopyButton>
      </div>
    </div>
  );
}
