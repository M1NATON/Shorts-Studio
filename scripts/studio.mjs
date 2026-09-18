/**
 * Одна команда — всё приложение (Plan.md §0): API с очередью и веб на одном URL.
 * Запуск: pnpm studio   → http://localhost:3100
 *
 * Переменные из .env подхватываются здесь же (process.loadEnvFile), значения
 * не печатаются. Если сборки нет — собирает.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const needsBuild = !existsSync("apps/server/dist/main.js") || !existsSync("apps/web/.next/BUILD_ID");
if (needsBuild || process.argv.includes("--build")) {
  console.log("Сборка…");
  const build = spawnSync("pnpm", ["build"], { stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

const WEB_PORT = process.env.WEB_PORT ?? "3100";
const children = [
  spawn("node", ["apps/server/dist/main.js"], { stdio: "inherit", env: process.env }),
  // Только localhost: у студии нет авторизации, а через прокси Next доступен весь
  // API — удаление проектов и запись ключей. По умолчанию next start слушает все
  // интерфейсы, то есть локальную сеть.
  spawn("pnpm", ["--filter", "@shorts/web", "exec", "next", "start", "--port", WEB_PORT, "--hostname", "127.0.0.1"], {
    stdio: "inherit",
    env: { ...process.env, STUDIO_API_URL: `http://127.0.0.1:${process.env.PORT ?? "3001"}` },
  }),
];
console.log(`\nShorts Studio: http://127.0.0.1:${WEB_PORT}\n`);

let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 3000).unref();
};
for (const child of children) child.on("exit", (code) => stop(code ?? 0));
process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
