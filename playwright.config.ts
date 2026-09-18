import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * Сквозной тест студии: e2e-сервер (фейковые модель и озвучка, настоящий рендер)
 * + веб в dev-режиме. Перед запуском: pnpm build.
 * Запуск: pnpm e2e  (CHROME_BIN — путь к Chrome, если браузеры Playwright не скачаны).
 */
const storage = mkdtempSync(path.join(tmpdir(), "studio-e2e-"));
const API_PORT = 3201;
const WEB_PORT = 3200;

export default defineConfig({
  testDir: "e2e",
  timeout: 300_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    viewport: { width: 1440, height: 1000 },
    ...(process.env.CHROME_BIN ? { launchOptions: { executablePath: process.env.CHROME_BIN } } : {}),
  },
  webServer: [
    {
      command: "node apps/server/dist/e2e-main.js",
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      env: { STORAGE_DIR: storage, PORT: String(API_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: `pnpm --filter @shorts/web exec next dev --port ${WEB_PORT} --hostname 127.0.0.1`,
      url: `http://127.0.0.1:${WEB_PORT}/`,
      env: { STUDIO_API_URL: `http://127.0.0.1:${API_PORT}`, NEXT_DIST_DIR: ".next-e2e" },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
