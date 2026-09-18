/**
 * Plan.md §3: ключи не должны попадать в браузерный бандл, манифесты и логи.
 * Скрипт берёт значения секретов из .env и ищет их в артефактах. Печатает только
 * имя переменной и файл — сами значения не выводятся никогда.
 *
 * Запуск: pnpm check:secrets  (после pnpm build)
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SECRET_VARS = ["LLM_API_KEY", "FISH_API_KEY", "FIRECRAWL_API_KEY"];
if (existsSync(".env")) process.loadEnvFile(".env");
const secrets = SECRET_VARS.map((name) => ({ name, value: process.env[name] })).filter((s) => s.value && s.value.length >= 8);
if (secrets.length === 0) {
  console.log("Секретов в окружении нет — проверять нечего.");
  process.exit(0);
}

/** Где искать: клиентский бандл, манифесты и JSON в storage, логи. База не проверяется — ключи из UI хранятся в ней намеренно. */
const ROOTS = ["apps/web/.next/static", "apps/web/.next/server/app", "storage"];
const SKIP = /\.(sqlite|sqlite-wal|sqlite-shm|wav|mp4|png|jpg)$/;

function* files(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) yield* files(full);
    else if (!SKIP.test(entry) && stat.size < 20_000_000) yield full;
  }
}

let leaks = 0;
let scanned = 0;
for (const root of ROOTS) {
  for (const file of files(root)) {
    scanned++;
    const content = readFileSync(file, "utf8");
    for (const { name, value } of secrets) {
      if (content.includes(value)) {
        console.error(`УТЕЧКА: значение ${name} найдено в ${file}`);
        leaks++;
      }
    }
  }
}
console.log(`Проверено файлов: ${scanned}, секретов: ${secrets.length}, утечек: ${leaks}`);
process.exit(leaks > 0 ? 1 : 0);
