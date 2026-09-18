"use client";
import { useEffect, useState } from "react";
import type { Manifest, VideoFormat } from "@shorts/contracts";
import { api, type Job, type Scene, type SceneVersion } from "@/lib/api";
import { useStudioEvents } from "@/lib/events";
import { INTENT_LABEL } from "@/lib/labels";
import { ArrowLeft, ArrowRight, Copy, Info, LoaderCircle, Mic, PenLine, Plus, Sparkles, Trash2, TriangleAlert, Undo2 } from "lucide-react";
import { pendingVariants } from "@/lib/variants";
import { BlockEditor } from "./BlockEditor";
import { sceneManifest, VideoPlayer } from "./VideoPlayer";

type Tab = "visual" | "text" | "ai" | "history";
const ICON = { size: 16, strokeWidth: 1.75 } as const;

const ORIGIN_LABEL: Record<SceneVersion["origin"], string> = {
  ai: "генерация",
  manual: "вручную",
  revoice: "переозвучка",
  rewrite: "переписано ИИ",
  variant: "вариант ИИ",
};

/**
 * Правка одной сцены. Остальные сцены не трогаются: ручная правка кадра —
 * мгновенно, новый текст — переозвучка только этой сцены, ИИ — варианты на выбор.
 */
export function SceneInspector({
  scene,
  count,
  format,
  manifest,
  activeJob,
  onChanged,
  onSelect,
  act,
  projectId,
}: {
  scene: Scene;
  count: number;
  format: VideoFormat;
  manifest?: Manifest;
  activeJob?: Job;
  onChanged: () => void;
  onSelect: (index: number) => void;
  act: (action: () => Promise<unknown>) => void;
  projectId: string;
}) {
  const [tab, setTab] = useState<Tab>("visual");
  const [narration, setNarration] = useState(scene.version.narration);
  const [instruction, setInstruction] = useState("");
  const [variantCount, setVariantCount] = useState(2);
  const [versions, setVersions] = useState<SceneVersion[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const busy = Boolean(activeJob);

  useEffect(() => {
    setNarration(scene.version.narration);
    setError(undefined);
  }, [scene.version.id, scene.version.narration]);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    api.versions(scene.id).then((r) => setVersions(r.versions)).catch(() => undefined);
  }, [scene.id, scene.version.id, activeJob?.status, tick]);
  // Быстрая задача может закончиться раньше, чем страница увидит её «в работе»:
  // тогда варианты не появились бы. Поэтому история перечитывается по событию.
  useStudioEvents((event) => {
    if (event.type === "job" && event.job.sceneIndex === scene.position && (event.job.status === "done" || event.job.status === "failed")) {
      setTick((t) => t + 1);
    }
  });

  const run = async (action: () => Promise<unknown>) => {
    setError(undefined);
    try {
      await action();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const variants = pendingVariants(versions, scene.version.id);
  const sceneIndex = manifest?.scenes.findIndex((s) => s.sceneId === scene.id) ?? -1;

  const i = scene.position;
  const duration = scene.version.audio?.durationSec;

  return (
    <div className="inspector">
      <div className="inspector-head">
        <strong>Сцена {i + 1}</strong>
        <span className="small muted">
          {scene.version.intent ? INTENT_LABEL[scene.version.intent] : ""}
          {duration ? <>{scene.version.intent ? " · " : ""}<span className="mono">{duration.toFixed(1)} с</span></> : null}
        </span>
        <div className="spacer" />
        <div className="row" style={{ gap: 0 }} role="toolbar" aria-label="Действия со сценой">
          <button className="btn ghost sm icon" disabled={i === 0} aria-label="Сдвинуть раньше (Alt+←)" title="Сдвинуть раньше (Alt+←)" onClick={() => { onSelect(i - 1); act(() => api.moveScene(scene.id, i - 1)); }}>
            <ArrowLeft {...ICON} />
          </button>
          <button className="btn ghost sm icon" disabled={i === count - 1} aria-label="Сдвинуть позже (Alt+→)" title="Сдвинуть позже (Alt+→)" onClick={() => { onSelect(i + 1); act(() => api.moveScene(scene.id, i + 1)); }}>
            <ArrowRight {...ICON} />
          </button>
          <button className="btn ghost sm icon" aria-label="Дублировать сцену" title="Дублировать сцену" onClick={() => act(() => api.duplicateScene(scene.id))}>
            <Copy {...ICON} />
          </button>
          <button
            className="btn ghost sm icon"
            aria-label="Добавить сцену после"
            title="Добавить сцену после"
            onClick={() => {
              const text = window.prompt("Текст озвучки новой сцены (кадр и озвучку соберёт ИИ):");
              if (text?.trim()) act(() => api.addScene(projectId, i, text.trim()));
            }}
          >
            <Plus {...ICON} />
          </button>
          <button
            className="btn ghost sm icon danger"
            disabled={count <= 1}
            aria-label="Удалить сцену"
            title="Удалить сцену"
            onClick={() => {
              if (window.confirm(`Удалить сцену ${i + 1}? Её версии тоже будут удалены.`)) {
                onSelect(Math.max(0, i - 1));
                act(() => api.deleteScene(scene.id));
              }
            }}
          >
            <Trash2 {...ICON} />
          </button>
        </div>
      </div>
      {scene.version.unverifiedNumbers.length > 0 ? (
        <div className="notice">
          <TriangleAlert size={14} strokeWidth={1.75} />
          <span>Нет в источниках: <b className="mono">{scene.version.unverifiedNumbers.join(", ")}</b>. Цифра могла быть посчитана — проверьте её глазами.</span>
        </div>
      ) : null}
      {scene.version.audio?.timingSource === "estimated" ? (
        <div className="small muted row" style={{ gap: 4 }} title="Тайминги слов оценены, не от провайдера"><Info size={14} strokeWidth={1.75} />Тайминги субтитров оценены приблизительно</div>
      ) : null}
      {activeJob ? <div className="small muted row" style={{ gap: 6 }} role="status"><LoaderCircle size={14} strokeWidth={1.75} className="spin" />{activeJob.message ?? activeJob.stage ?? "в очереди"}</div> : null}
      {error ? <div className="issues">{error}</div> : null}

      <div className="tabs" role="tablist" aria-label="Правка сцены">
        {([["visual", "Кадр"], ["text", "Текст"], ["ai", "ИИ"], ["history", "История"]] as const).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}{key === "history" && versions.length ? <span className="count">{versions.length}</span> : null}
          </button>
        ))}
      </div>

      {tab === "visual" ? (
        <BlockEditor
          key={scene.version.id}
          visual={scene.version.visual}
          format={format}
          saving={saving}
          onSave={async (visual) => {
            setSaving(true);
            try {
              await api.saveVisual(scene.id, visual);
              onChanged();
            } finally {
              setSaving(false);
            }
          }}
        />
      ) : null}

      {tab === "text" ? (
        <div className="stack">
          <label className="section-title" htmlFor="narration">Текст озвучки</label>
          <textarea id="narration" className="textarea" rows={5} value={narration} maxLength={320} onChange={(e) => setNarration(e.target.value)} />
          <div className="row">
            <button className="btn pri" disabled={busy || narration.trim() === scene.version.narration || !narration.trim()} onClick={() => void run(() => api.setNarration(scene.id, narration.trim()))}>
              Сохранить и озвучить
            </button>
            <button className="btn" disabled={busy} title="Тот же текст, новый дубль" onClick={() => void run(() => api.revoice(scene.id))}><Mic {...ICON} />Переозвучить</button>
          </div>
          <p className="small muted">Озвучивается только эта сцена; следующие сцены сдвигаются автоматически. <span className="mono">{narration.length}/320</span></p>
        </div>
      ) : null}

      {tab === "ai" ? (
        <div className="stack">
          <label className="section-title" htmlFor="instruction">Пожелание (необязательно)</label>
          <textarea id="instruction" className="textarea" rows={2} placeholder="сделай столбцами · меньше текста · акцент на цифре" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
          <div className="row">
            <button className="btn pri" disabled={busy} onClick={() => void run(() => api.regenerate(scene.id, instruction.trim(), variantCount))}>
              <Sparkles {...ICON} />Пересобрать кадр
            </button>
            <div className="seg" role="radiogroup" aria-label="Число вариантов">
              {[1, 2, 3].map((n) => (
                <button key={n} role="radio" aria-checked={variantCount === n} aria-label={`${n} вар.`} onClick={() => setVariantCount(n)}>{n}</button>
              ))}
            </div>
          </div>
          <div className="row">
            <button className="btn" disabled={busy} title="Новый текст, кадр и озвучка этой сцены" onClick={() => void run(() => api.rewrite(scene.id, instruction.trim()))}>
              <PenLine {...ICON} />Переписать сцену
            </button>
          </div>
          {variants.length > 0 && manifest && sceneIndex >= 0 ? (
            <>
              <p className="section-title">Варианты — нажмите, чтобы выбрать</p>
              <div className="variants">
                {variants.map((v) => (
                  <button key={v.id} className="variant" aria-label={`Выбрать вариант: ${v.note ?? "вариант"}`} onClick={() => void run(() => api.selectVersion(scene.id, v.id))}>
                    <div style={{ aspectRatio: format === "landscape" ? "16 / 9" : "9 / 16", display: "grid", placeItems: "center" }}>
                      <VideoPlayer manifest={sceneManifest(manifest, sceneIndex, v.visual)} controls={false} muted autoPlay loop />
                    </div>
                    <div className="label">{v.note ?? "вариант"}</div>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {tab === "history" ? (
        <div>
          {versions.map((v) => (
            <div key={v.id} className={`version${v.id === scene.version.id ? " current" : ""}`}>
              <div style={{ minWidth: 0 }}>
                <div className="what">{ORIGIN_LABEL[v.origin]}{v.id === scene.version.id ? <span className="pill">текущая</span> : null}</div>
                <div className="when">{new Date(v.createdAt).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{v.note ? <span className="muted"> · {v.note}</span> : null}</div>
                <div className="text" title={v.narration}>{v.narration}</div>
              </div>
              {v.id !== scene.version.id ? (
                <button className="btn sm" onClick={() => void run(() => api.selectVersion(scene.id, v.id))}><Undo2 size={14} strokeWidth={1.75} />Вернуть</button>
              ) : null}
            </div>
          ))}
          <p className="small muted" style={{ marginTop: 10 }}>Версии не удаляются: неудачная пересборка не губит исходник.</p>
        </div>
      ) : null}
    </div>
  );
}

