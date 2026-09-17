import path from "node:path";
import { bundle } from "@remotion/bundler";
import { ensureBrowser, renderMedia, selectComposition } from "@remotion/renderer";
import type { Manifest } from "@shorts/contracts";
import { COMPOSITION_ID } from "./Root.js";

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

  const serveUrl = await bundle({
    entryPoint,
    publicDir: options.storageDir,
    // Bundler по умолчанию печатает прогресс в stdout; в воркере это лишний шум.
    onProgress: () => undefined,
  });

  const inputProps = { manifest: options.manifest };
  const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps });

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    outputLocation: options.outputPath,
    inputProps,
    onProgress: ({ progress }) => options.onProgress?.(progress),
  });

  return options.outputPath;
}
