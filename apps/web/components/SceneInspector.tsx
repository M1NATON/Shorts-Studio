"use client";
import { useEffect, useState } from "react";
import type { Manifest, VideoFormat } from "@shorts/contracts";
import { api, type Job, type Scene, type SceneVersion } from "@/lib/api";
import { useStudioEvents } from "@/lib/events";
import { formatDate } from "@/lib/format";
import { pendingVariants } from "@/lib/variants";
import { BlockEditor } from "./BlockEditor";
import { sceneManifest, VideoPlayer } from "./VideoPlayer";

type Tab = "visual" | "text" | "ai" | "history";

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
  format,
  manifest,
  activeJob,
  onChanged,
}: {
  scene: Scene;
  format: VideoFormat;
  manifest?: Manifest;
  activeJob?: Job;
  onChanged: () => void;
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

  return (
    <div className="inspector">
      <div className="row">
        <strong>Сцена {scene.position + 1}</strong>
        <span className="small muted">{scene.version.intent ?? ""}</span>
        <div className="spacer" />
        {scene.version.audio?.timingSource === "estimated" ? <span className="badge stale" title="Тайминги слов оценены, не от провайдера">≈ тайминги</span> : null}
      </div>
      {scene.version.unverifiedNumbers.length > 0 ? (
        <div className="issues" style={{ borderColor: "rgba(251,191,36,.5)", background: "rgba(251,191,36,.08)" }}>
          <span className="warn">Нет в источниках: {scene.version.unverifiedNumbers.join(", ")}.</span>{" "}
          <span className="muted">Цифра могла быть посчитана — проверьте её глазами.</span>
        </div>
      ) : null}
      {activeJob ? <div className="small muted">⏳ {activeJob.message ?? activeJob.stage ?? "в очереди"}</div> : null}
      {error ? <div className="issues">{error}</div> : null}

      <div className="seg">
        {([["visual", "Кадр"], ["text", "Текст"], ["ai", "ИИ"], ["history", `История (${versions.length})`]] as const).map(([key, label]) => (
          <button key={key} className={tab === key ? "on" : ""} onClick={() => setTab(key)}>{label}</button>
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
          <p className="section-title">Текст озвучки</p>
          <textarea className="textarea" rows={4} value={narration} maxLength={320} onChange={(e) => setNarration(e.target.value)} />
          <div className="row">
            <button className="btn primary" disabled={busy || narration.trim() === scene.version.narration || !narration.trim()} onClick={() => void run(() => api.setNarration(scene.id, narration.trim()))}>
              Сохранить и озвучить
            </button>
            <button className="btn" disabled={busy} title="Тот же текст, новый дубль" onClick={() => void run(() => api.revoice(scene.id))}>Переозвучить</button>
          </div>
          <p className="small muted">Озвучивается только эта сцена; длительности следующих сцен сдвигаются автоматически.</p>
        </div>
      ) : null}

      {tab === "ai" ? (
        <div className="stack">
          <p className="section-title">Пожелание (необязательно)</p>
          <textarea className="textarea" rows={2} placeholder="сделай столбцами · меньше текста · акцент на цифре" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
          <div className="row">
            <button className="btn primary" disabled={busy} onClick={() => void run(() => api.regenerate(scene.id, instruction.trim(), variantCount))}>Пересобрать кадр</button>
            <select className="select" value={variantCount} onChange={(e) => setVariantCount(Number(e.target.value))}>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>{n} вар.</option>
              ))}
            </select>
            <button className="btn" disabled={busy} title="Новый текст, кадр и озвучка этой сцены" onClick={() => void run(() => api.rewrite(scene.id, instruction.trim()))}>Переписать сцену</button>
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
            <div key={v.id} className="version">
              <div>
                <div>{ORIGIN_LABEL[v.origin]}{v.id === scene.version.id ? " · текущая" : ""}</div>
                <div className="muted">{new Date(v.createdAt).toLocaleString("ru-RU")}{v.note ? ` · ${v.note}` : ""}</div>
                <div className="muted" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.narration}</div>
              </div>
              {v.id !== scene.version.id ? (
                <button className="btn sm" onClick={() => void run(() => api.selectVersion(scene.id, v.id))}>Вернуть</button>
              ) : null}
            </div>
          ))}
          <p className="small muted">Версии не удаляются: неудачная пересборка не губит исходник. {formatDate(null)}</p>
        </div>
      ) : null}
    </div>
  );
}

