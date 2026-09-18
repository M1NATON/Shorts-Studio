/**
 * Фон сцены с Pexels: найти фото/видео по короткому запросу модели и скачать файл
 * в проект. Ключ хранится в настройках студии (Настройки → Провайдеры), как у
 * остальных провайдеров — сюда приходит уже готовым.
 */
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

export type MediaKind = "photo" | "video";
export type MediaOrientation = "portrait" | "landscape";

export interface PexelsCandidate {
  readonly pexelsId: number;
  /** URL файла, скачиваемого без авторизации (CDN Pexels). */
  readonly url: string;
  readonly width: number;
  readonly height: number;
  /** Только для видео. */
  readonly durationSec?: number;
  readonly credit: { readonly name: string; readonly url: string };
}

export interface SearchPexelsOptions {
  readonly apiKey: string;
  readonly query: string;
  readonly kind: MediaKind;
  readonly orientation: MediaOrientation;
  readonly page?: number;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

const PHOTO_SEARCH_URL = "https://api.pexels.com/v1/search";
const VIDEO_SEARCH_URL = "https://api.pexels.com/videos/search";
const PER_PAGE = 10;

interface PexelsPhoto {
  readonly id: number;
  readonly width: number;
  readonly height: number;
  readonly photographer: string;
  readonly photographer_url: string;
  readonly src: Record<string, string>;
}

const isId = (id: unknown): id is number => Number.isSafeInteger(id) && (id as number) > 0;

function parsePhotos(payload: unknown, orientation: MediaOrientation): PexelsCandidate[] {
  const photos = ((payload as { photos?: PexelsPhoto[] })?.photos ?? []) as PexelsPhoto[];
  return photos.flatMap((photo) => {
    const src = orientation === "portrait" ? photo.src?.portrait : photo.src?.large2x;
    // id идёт в имя файла — только положительное целое.
    if (!src || !isId(photo.id)) return [];
    return [
      {
        pexelsId: photo.id,
        url: src,
        width: photo.width,
        height: photo.height,
        credit: { name: photo.photographer, url: photo.photographer_url },
      },
    ];
  });
}

interface PexelsVideoFile {
  readonly file_type: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly link: string;
}

interface PexelsVideo {
  readonly id: number;
  readonly duration: number;
  readonly user: { readonly name: string; readonly url: string };
  readonly video_files: PexelsVideoFile[];
}

/** Ближе всего к целевой ширине (1080 portrait / 1920 landscape), но не мельче 720 и не крупнее 1920. */
function pickVideoFile(files: readonly PexelsVideoFile[], orientation: MediaOrientation): PexelsVideoFile | undefined {
  const target = orientation === "portrait" ? 1080 : 1920;
  const candidates = files.filter(
    (f): f is PexelsVideoFile & { width: number } => f.file_type === "video/mp4" && f.width !== null && f.width >= 720 && f.width <= 1920,
  );
  if (candidates.length === 0) return undefined;
  return candidates.reduce((best, f) => (Math.abs(f.width - target) < Math.abs(best.width! - target) ? f : best));
}

function parseVideos(payload: unknown, orientation: MediaOrientation): PexelsCandidate[] {
  const videos = ((payload as { videos?: PexelsVideo[] })?.videos ?? []) as PexelsVideo[];
  return videos.flatMap((video) => {
    const file = pickVideoFile(video.video_files ?? [], orientation);
    if (!file || file.width === null || file.height === null || !isId(video.id)) return [];
    return [
      {
        pexelsId: video.id,
        url: file.link,
        width: file.width,
        height: file.height,
        durationSec: video.duration,
        credit: { name: video.user.name, url: video.user.url },
      },
    ];
  });
}

/** Кандидаты по запросу, одна страница (10 штук). Пустой массив — ничего не нашлось. */
export async function searchPexels(options: SearchPexelsOptions): Promise<PexelsCandidate[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const base = options.kind === "photo" ? PHOTO_SEARCH_URL : VIDEO_SEARCH_URL;
  const params = new URLSearchParams({
    query: options.query,
    orientation: options.orientation,
    per_page: String(PER_PAGE),
    page: String(options.page ?? 1),
  });
  const res = await fetchImpl(`${base}?${params}`, {
    headers: { Authorization: options.apiKey },
    signal: AbortSignal.timeout(options.timeoutMs ?? 20000),
  });
  if (!res.ok) throw new Error(`Pexels HTTP ${res.status}`);
  const payload = await res.json();
  return options.kind === "photo" ? parsePhotos(payload, options.orientation) : parseVideos(payload, options.orientation);
}

/**
 * Хосты, с которых реально можно скачать файл кандидата: собственный CDN Pexels
 * для фото и для видео. Открывать этот список для произвольного URL из ответа
 * API нельзя — кандидат мог бы указать на что угодно (SSRF).
 */
const ALLOWED_HOSTS = new Set(["images.pexels.com", "videos.pexels.com"]);
const DEFAULT_MAX_BYTES = 80 * 1024 * 1024;

export interface DownloadMediaOptions {
  readonly url: string;
  /** Куда положить файл; имя строит вызывающий код (sceneId+pexelsId), не URL. */
  readonly dest: string;
  readonly fetchImpl?: typeof fetch;
  readonly maxBytes?: number;
  readonly timeoutMs?: number;
}

/** Скачать файл кандидата на диск: временный файл + rename, обрыв — частичный файл удалён. */
export async function downloadMedia(options: DownloadMediaOptions): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const parsed = new URL(options.url);
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error(`refused to download media from ${parsed.hostname || options.url}`);
  }

  // redirect: "error" — иначе редирект увёл бы запрос мимо проверки хоста выше.
  const res = await fetchImpl(options.url, { redirect: "error", signal: AbortSignal.timeout(options.timeoutMs ?? 60000) });
  if (!res.ok) throw new Error(`media HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/") && !contentType.startsWith("video/")) {
    throw new Error(`unexpected content-type: ${contentType || "none"}`);
  }
  if (!res.body) throw new Error("empty response body");

  await mkdir(path.dirname(options.dest), { recursive: true });
  const tmp = `${options.dest}.part`;
  let bytes = 0;
  const counted = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        callback(new Error(`media exceeds ${maxBytes} bytes`));
        return;
      }
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), counted, createWriteStream(tmp));
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
  await rename(tmp, options.dest);
}
