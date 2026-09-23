/**
 * Клиент API студии. Типы ответов описаны здесь, а не импортом из @shorts/db:
 * база тянет node:sqlite, в браузерный бандл она попасть не должна.
 */
import type { CaptionStyle, Manifest, PublishMeta, SceneIntent, SceneMedia, SceneVisualSpec, StyleChoice, VideoFormat, VideoTheme, WordTiming } from "@shorts/contracts";

export type { PublishMeta } from "@shorts/contracts";

export type ProjectStatus = "generating" | "draft" | "ready" | "stale" | "failed";
export type Freshness = "current" | "evergreen";

export interface Project {
  id: string;
  topic: string;
  title: string | null;
  format: VideoFormat;
  captionStyle: CaptionStyle;
  style: StyleChoice;
  status: ProjectStatus;
  freshnessRequested: Freshness | null;
  freshness: Freshness | null;
  researchedAt: string | null;
  minutes: number | null;
  theme: VideoTheme | null;
  music: ProjectMusic | null;
  publish: PublishMeta | null;
  sources: { url: string; title: string; kind?: "web" | "news"; publishedAt?: string }[];
  chapters: { title: string; firstScene: number }[];
  thumbnailPath: string | null;
  durationSec: number | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SceneVersion {
  id: string;
  sceneId: string;
  narration: string;
  intent: SceneIntent | null;
  visual: SceneVisualSpec;
  audio: { path: string; hash: string; durationSec: number; words: WordTiming[]; timingSource: "native" | "estimated" } | null;
  unverifiedNumbers: string[];
  origin: "ai" | "manual" | "revoice" | "rewrite" | "variant";
  note: string | null;
  /** Пачка вариантов одной пересборки. */
  batchId: string | null;
  createdAt: string;
}

export interface Scene {
  id: string;
  position: number;
  version: SceneVersion;
  media: SceneMedia | null;
}

export interface Job {
  id: string;
  projectId: string | null;
  kind: "generate" | "render" | "regenerate-scene" | "revoice-scene" | "rewrite-scene" | "thumbnail";
  status: "queued" | "running" | "done" | "failed";
  stage: string | null;
  message: string | null;
  done: number | null;
  total: number | null;
  sceneIndex: number | null;
  payload: unknown;
  result: unknown;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
}

export interface ProjectMusic {
  track: string;
  volume: number;
}
export interface MusicTrack {
  file: string;
  mood: string | null;
}

export type QueueJob = Job & { projectTitle: string | null };
export interface Queue {
  running: QueueJob[];
  queued: QueueJob[];
  recent: QueueJob[];
}

export interface ProjectDetail {
  project: Project;
  scenes: Scene[];
  render: { id: string; manifestHash: string; path: string; createdAt: string } | null;
  jobs: Job[];
}

export type ProviderKind = "llm" | "tts" | "search" | "media";
export interface ProviderInfo {
  configured: boolean;
  source: "ui" | "env" | null;
  /** apiKey приходит маской «••••1234», остальные поля — как есть. */
  fields: Record<string, string | null>;
}

/** Значения по умолчанию для новых роликов (Настройки → Предпочтения). */
export interface Preferences {
  format: VideoFormat;
  minutes: number;
  freshness: Freshness | "auto";
  captionStyle: CaptionStyle;
  style: StyleChoice;
  research: boolean;
  exportDir: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: { path: string; message: string }[] };
  if (!res.ok) throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status, body.issues ?? []);
  return body as T;
}

const post = <T>(url: string, body?: unknown) => request<T>(url, { method: "POST", body: JSON.stringify(body ?? {}) });

export const api = {
  listProjects: (query: { search?: string; status?: string; format?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) if (value !== undefined && value !== "") params.set(key, String(value));
    return request<{ items: Project[]; total: number }>(`/api/projects?${params}`);
  },
  createProjects: (input: { topics: string[]; format?: VideoFormat; captionStyle?: CaptionStyle; style?: StyleChoice; freshness?: Freshness; minutes?: number }) =>
    input.topics.length === 1
      ? post<{ project: Project }>("/api/projects", { ...input, topic: input.topics[0], topics: undefined }).then((r) => [r.project])
      : post<{ items: { project: Project }[] }>("/api/projects/batch", input).then((r) => r.items.map((i) => i.project)),
  project: (id: string) => request<ProjectDetail>(`/api/projects/${id}`),
  manifest: (id: string) => request<{ manifest: Manifest; hash: string }>(`/api/projects/${id}/manifest`),
  setCaptionStyle: (id: string, captionStyle: CaptionStyle) =>
    request<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ captionStyle }) }),
  setMusic: (id: string, music: ProjectMusic | null) =>
    request<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ music }) }),
  music: () => request<MusicTrack[]>("/api/music"),
  regeneratePublish: (id: string) => post<PublishMeta>(`/api/projects/${id}/publish`),
  setPublish: (id: string, publish: PublishMeta | null) =>
    request<Project>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ publish }) }),
  deleteProject: (id: string) => request<void>(`/api/projects/${id}`, { method: "DELETE" }),
  duplicate: (id: string) => post<{ project: Project }>(`/api/projects/${id}/duplicate`),
  retry: (id: string) => post<{ job: Job }>(`/api/projects/${id}/retry`),
  render: (id: string) => post<{ job: Job }>(`/api/projects/${id}/render`),
  exportToFolder: (id: string) => post<{ dir: string }>(`/api/projects/${id}/export`),
  versions: (sceneId: string) => request<{ scene: Scene; versions: SceneVersion[] }>(`/api/scenes/${sceneId}/versions`),
  saveVisual: (sceneId: string, visual: unknown) =>
    request<{ ok: true; versionId: string }>(`/api/scenes/${sceneId}/visual`, { method: "PUT", body: JSON.stringify({ visual }) }),
  regenerate: (sceneId: string, instruction: string, variants: number) =>
    post<{ job: Job }>(`/api/scenes/${sceneId}/regenerate`, { instruction: instruction || undefined, variants }),
  rewrite: (sceneId: string, instruction: string) => post<{ job: Job }>(`/api/scenes/${sceneId}/rewrite`, { instruction: instruction || undefined }),
  setNarration: (sceneId: string, narration: string) => post<{ job: Job }>(`/api/scenes/${sceneId}/narration`, { narration }),
  revoice: (sceneId: string) => post<{ job: Job }>(`/api/scenes/${sceneId}/revoice`),
  selectVersion: (sceneId: string, versionId: string) => post<{ ok: true }>(`/api/scenes/${sceneId}/versions/${versionId}/select`),
  jobs: (projectId?: string, active = false) =>
    request<Job[]>(`/api/jobs?${new URLSearchParams({ ...(projectId ? { projectId } : {}), ...(active ? { active: "1" } : {}) })}`),
  queue: () => request<Queue>("/api/queue"),
  /** Задача из очереди отменяется сразу (Job); идущая — останавливается воркером, итог придёт событием. */
  cancelJob: (jobId: string) => post<Job | { cancelling: true }>(`/api/jobs/${jobId}/cancel`),
  settings: () => request<Record<ProviderKind, ProviderInfo>>("/api/settings"),
  saveSettings: (kind: ProviderKind, fields: Record<string, string>) =>
    request<ProviderInfo>(`/api/settings/${kind}`, { method: "PUT", body: JSON.stringify(fields) }),
  testSettings: (kind: ProviderKind) => post<{ ok: boolean; message: string }>(`/api/settings/${kind}/test`),
  /** Образец голоса: WAV как Blob. Голос и модель — из формы, ключ сервер берёт сохранённый. */
  previewVoice: async (input: { referenceId?: string; model?: string }) => {
    const res = await fetch("/api/settings/tts/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new ApiError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`, res.status);
    return res.blob();
  },
  preferences: () => request<Preferences>("/api/preferences"),
  savePreferences: (patch: Partial<Preferences>) =>
    request<Preferences>("/api/preferences", { method: "PUT", body: JSON.stringify(patch) }),
  moveScene: (sceneId: string, position: number) => post<{ ok: true }>(`/api/scenes/${sceneId}/move`, { position }),
  duplicateScene: (sceneId: string) => post<{ sceneId: string }>(`/api/scenes/${sceneId}/duplicate`),
  deleteScene: (sceneId: string) => request<void>(`/api/scenes/${sceneId}`, { method: "DELETE" }),
  addScene: (projectId: string, afterPosition: number, narration: string) =>
    post<{ sceneId: string; job: Job }>(`/api/projects/${projectId}/scenes`, { afterPosition, narration }),
  setSceneMedia: (sceneId: string, body: { query?: string; kind?: "photo" | "video"; next?: boolean }) =>
    post<Scene & { projectId: string }>(`/api/scenes/${sceneId}/media`, body),
  deleteSceneMedia: (sceneId: string) => request<Scene & { projectId: string }>(`/api/scenes/${sceneId}/media`, { method: "DELETE" }),
};

export const videoUrl = (id: string) => `/api/projects/${id}/video`;
export const mediaUrl = (relPath: string, version?: string) => `/${relPath}${version ? `?v=${encodeURIComponent(version)}` : ""}`;
