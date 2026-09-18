"use client";
import type { VideoFormat } from "@shorts/contracts";
import type { Job } from "@/lib/api";
import { jobProgress } from "@/lib/format";

/** Этапы генерации по порядку; стадии llm-core сведены к шести шагам. */
const STEPS = ["Источники", "План", "Кадры", "Проверка", "Озвучка", "Обложка"] as const;
const STEP_OF: Record<string, number> = { research: 0, theme: 0, outline: 1, plan: 1, fill: 2, check: 3, voice: 4, thumbnail: 5 };
const MAX_FRAMES = 12;

/**
 * Сборка ролика вживую: лента кадров проявляется по мере того, как модель
 * заполняет сцены, на озвучке по ней идёт плейхед, снизу — шаги конвейера.
 * Только CSS-анимации; при prefers-reduced-motion остаются статичные состояния.
 */
export function GenerationProgress({ job, format, topic, large = false }: { job: Job; format: VideoFormat; topic?: string; large?: boolean }) {
  const queued = job.status === "queued";
  const step = queued ? -1 : (STEP_OF[job.stage ?? ""] ?? 0);
  const counted = (job.stage === "fill" || job.stage === "voice") && job.total ? job.total : undefined;
  const frames = Math.min(MAX_FRAMES, counted ?? (format === "landscape" ? 8 : 6));
  const share = counted ? (job.done ?? 0) / counted : 0;
  const built = step > 2 ? frames : step === 2 ? Math.floor(share * frames) : 0;
  const head = step === 4 ? share : step > 4 ? 1 : step === 2 ? built / frames : 0;

  return (
    <div className={`gen${large ? " large" : ""}${queued ? " queued" : ""}${format === "landscape" ? " landscape" : ""}`} role="status" aria-label={jobProgress(job)}>
      {topic ? <div className="gen-topic">{topic}</div> : null}
      <div className="gen-strip" aria-hidden="true">
        {Array.from({ length: frames }, (_, i) => (
          <div key={i} className={`gen-frame${i < built ? " done" : ""}${step === 2 && i === built ? " now" : ""}`} style={{ "--i": i } as React.CSSProperties}>
            <span className="ln" />
            <span className="ln" />
            <span className="ln" />
          </div>
        ))}
        {step >= 2 ? <div className="gen-head" style={{ left: `calc(${head * 100}% - 1px)` }} /> : null}
      </div>
      {step === 4 ? (
        <div className="gen-wave" aria-hidden="true">
          {Array.from({ length: large ? 28 : 14 }, (_, i) => <i key={i} style={{ "--i": i } as React.CSSProperties} />)}
        </div>
      ) : null}
      <div className="gen-label">
        <b>{queued ? "В очереди" : (STEPS[step] ?? "Сборка")}</b>
        <span className="mono">{job.total && counted ? `${job.done ?? 0}/${job.total}` : queued ? "" : `${step + 1}/${STEPS.length}`}</span>
      </div>
      <div className="gen-steps" aria-hidden="true">
        <div className="fill" style={{ width: `calc((100% - 12px) * ${Math.max(0, step) / (STEPS.length - 1)})` }} />
        {STEPS.map((name, i) => <span key={name} className={i < step ? "done" : i === step ? "now" : ""} />)}
      </div>
      {large ? (
        <div className="gen-names" aria-hidden="true">
          {STEPS.map((name, i) => <span key={name} className={i === step ? "now" : ""}>{name}</span>)}
        </div>
      ) : null}
    </div>
  );
}
