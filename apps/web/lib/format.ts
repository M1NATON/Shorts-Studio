import type { CaptionStyle } from "@shorts/contracts";
import type { Job, ProjectStatus } from "./api";

/** Длины 16:9 в минутах — одинаковый список в форме создания и в Предпочтениях. */
export const MINUTES_OPTIONS = [2, 3, 5, 8, 10, 15] as const;

export const CAPTION_LABEL: Record<CaptionStyle, string> = {
  karaoke: "караоке",
  clean: "чистые",
  boxed: "на плашке",
  outline: "с обводкой",
};

export const STATUS_LABEL: Record<ProjectStatus, string> = {
  generating: "Генерация",
  draft: "Черновик",
  ready: "Готов",
  stale: "Устарел",
  failed: "Ошибка",
};

export const STATUS_HINT: Record<ProjectStatus, string> = {
  generating: "Сценарий, озвучка и обложка собираются",
  draft: "MP4 ещё не экспортирован",
  ready: "MP4 соответствует текущим сценам",
  stale: "Сцены правили после экспорта — MP4 устарел",
  failed: "Генерация не удалась",
};

export const STAGE_LABEL: Record<string, string> = {
  research: "Поиск источников",
  theme: "Дизайн",
  outline: "План",
  plan: "Раскладка",
  fill: "Сцены",
  check: "Проверка чисел",
  voice: "Озвучка",
  media: "Фото и видео",
  thumbnail: "Обложка",
  render: "Рендер",
  done: "Готово",
};

/** Текущий этап человеческим языком, без «done/total» — для карточек, где прогресс показан отдельно. */
export function stageText(job: Job): string {
  return job.message ?? (job.stage ? (STAGE_LABEL[job.stage] ?? job.stage) : job.status === "queued" ? "В очереди" : "…");
}

export function jobProgress(job: Job): string {
  const stage = stageText(job);
  return job.total ? `${stage} · ${job.done ?? 0}/${job.total}` : stage;
}

export const formatDate = (iso: string | null): string =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("ru-RU") : "";

/** «18 сен», для прошлых лет — «18 сен 2025». */
export const formatShortDate = (iso: string): string => {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) }).replace(".", "");
};

export const formatDuration = (sec: number | null): string => {
  if (!sec) return "";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

/** «5 мин назад» для недавних событий очереди. */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const diffMin = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "только что";
  if (diffMin < 60) return `${diffMin} мин назад`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH} ч назад`;
  return formatShortDate(iso);
}

/** «1 ролик», «2 ролика», «5 роликов». */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
