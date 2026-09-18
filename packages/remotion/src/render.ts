import path from "node:path";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, renderStill, selectComposition, type OpenGlRenderer } from "@remotion/renderer";
import type { Manifest } from "@shorts/contracts";
import { COMPOSITION_ID } from "./Root.js";

/**
 * Бандл Remotion собирается webpack-ом 10–20 с. Сервер рендерит много раз за
 * жизнь процесса, поэтому бандл кешируется по точке входа и каталогу storage.
 * Код компонентов меняется только с перезапуском процесса — кеш этому не мешает.
 */
const bundles = new Map<string, Promise<string>>();
function cachedBundle(entryPoint: string, publicDir: string): Promise<string> {
  const key = `${entryPoint}|${publicDir}`;
  let serveUrl = bundles.get(key);
  if (!serveUrl) {
    // Bundler по умолчанию печатает прогресс в stdout; в воркере это лишний шум.
    // symlinkPublicDir: бандл ссылается на storage, а не копирует его. Иначе
    // озвучка, записанная после сборки бандла (новый текст сцены), в кеше
    // отсутствовала — рендер падал с 404, — а копия storage с сотней роликов
    // занимала бы гигабайты на каждую сборку.
    serveUrl = bundle({ entryPoint, publicDir, symlinkPublicDir: true, onProgress: () => undefined });
    // Упавшая сборка не должна закешироваться навсегда.
    serveUrl.catch(() => bundles.delete(key));
    bundles.set(key, serveUrl);
  }
  return serveUrl;
}

export interface RenderOptions {
  manifest: Manifest;
  outputPath: string;
  /** Каталог storage: отдаётся Remotion как publicDir, поэтому audioSrc в манифесте относительный. */
  storageDir: string;
  /** Точка входа Remotion. По умолчанию — entry этого пакета. */
  entryPoint?: string;
  onProgress?: (progress: number) => void;
}

/**
 * Финальный рендер MP4.
 *
 * Тот же манифест и те же компоненты, что в preview: сцены берутся из SceneVisual,
 * поэтому расхождение preview/export возможно только через окружение (шрифты),
 * а не через логику.
 */
export async function renderVideo(options: RenderOptions): Promise<string> {
  const entryPoint =
    options.entryPoint ?? path.join(path.dirname(new URL(import.meta.url).pathname), "entry.js");

  await ensureBrowser();

  const serveUrl = await cachedBundle(entryPoint, options.storageDir);

  const inputProps = { manifest: options.manifest };
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });

  // GPU-рендер: замер на 16-ядерной RTX 4060 показал ~30% ускорение у связки
  // gl "vulkan" (рисует кадры в Chromium на GPU) + hardwareAcceleration
  // "if-possible" (кодирует h264_nvenc, сам откатывается на libx264, если в
  // сборке ffmpeg нет nvenc). concurrency не переопределяем по умолчанию —
  // ремоушен сам берёт половину ядер, это переносимо между машинами.
  // Отключение/замена — env: RENDER_HW=off, RENDER_GL=off|angle|egl|…, RENDER_CONCURRENCY=12.
  const hardwareAcceleration = process.env.RENDER_HW === "off" ? "disable" : "if-possible";
  const gl = process.env.RENDER_GL === "off" ? undefined : ((process.env.RENDER_GL as OpenGlRenderer | undefined) ?? "vulkan");
  const concurrency = process.env.RENDER_CONCURRENCY ? Number(process.env.RENDER_CONCURRENCY) : undefined;

  const renderOnce = (withGl: boolean) =>
    renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: options.outputPath,
      inputProps,
      onProgress: ({ progress }) => options.onProgress?.(progress),
      hardwareAcceleration,
      // nvenc без битрейта даёт ~2 Мбит/с — мало для фото/видео-фона в движении;
      // 8 Мбит/с — рекомендация YouTube для загрузки 1080p. crf с nvenc несовместим.
      videoBitrate: "8M",
      ...(withGl && gl ? { chromiumOptions: { gl } } : {}),
      ...(concurrency ? { concurrency } : {}),
    });

  try {
    await renderOnce(true);
  } catch (err) {
    // На машине без GPU (или без нужного драйвера) Chromium может не запуститься
    // с выбранным gl — тогда рендерим тем же процессом без него, а не роняем job.
    if (!gl) throw err;
    console.warn(`renderVideo: рендер с gl="${gl}" не запустился, повтор без GPU-рендера кадров: ${String(err)}`);
    await renderOnce(false);
  }

  return options.outputPath;
}

export interface StillsOptions {
  manifest: Manifest;
  storageDir: string;
  /** Номера кадров всего ролика. */
  frames: readonly number[];
  /** Путь к PNG по номеру кадра. */
  outputPath: (frame: number) => string;
  entryPoint?: string;
}

/**
 * Отдельные кадры в PNG — один бандл на все кадры.
 * Нужен для быстрой проверки визуала (секунды вместо рендера MP4) и для обложек.
 */
export async function renderStills(options: StillsOptions): Promise<string[]> {
  const entryPoint =
    options.entryPoint ?? path.join(path.dirname(new URL(import.meta.url).pathname), "entry.js");
  await ensureBrowser();
  const serveUrl = await cachedBundle(entryPoint, options.storageDir);
  const inputProps = { manifest: options.manifest };
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });

  const written: string[] = [];
  for (const frame of options.frames) {
    const output = options.outputPath(frame);
    await renderStill({ composition, serveUrl, frame, output, inputProps });
    written.push(output);
  }
  return written;
}
