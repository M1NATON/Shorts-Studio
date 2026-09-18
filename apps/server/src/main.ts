/**
 * Точка входа сервера: конфиг из окружения, база, воркер очереди, HTTP.
 * Запуск: pnpm studio (или node apps/server/dist/main.js с переменными из .env).
 */
import { mkdirSync } from "node:fs";
import { createRepository, openDatabase } from "@shorts/db";
import { createOpenAiCompatibleClient, searchSources, todayIso } from "@shorts/llm-core";
import { downloadMedia as downloadPexelsMedia, searchPexels, synthesizeFish, voiceNarration } from "@shorts/media-core";
import { renderStills, renderVideo } from "@shorts/remotion";
import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { StudioEvents } from "./events.js";
import { JobError, type PipelineDeps } from "./pipeline.js";
import { createProviderStore, loadPreferences, type ProviderKind } from "@shorts/db";
import { limiter, startWorker } from "./worker.js";

const config = loadConfig();
mkdirSync(config.storageDir, { recursive: true });
const database = openDatabase(config.dbPath);
const repo = createRepository(database);
const events = new StudioEvents();
const providers = createProviderStore(repo, config.envProviders);

const interrupted = await repo.failInterruptedJobs();
if (interrupted > 0) console.log(`незавершённых задач после рестарта: ${interrupted} → failed`);

async function requireLlm() {
  const { llm } = await providers.current();
  if (!llm) throw new JobError("Модель не настроена: Настройки → Модель (или LLM_* в .env)");
  return llm;
}
async function requireTts() {
  const { tts } = await providers.current();
  if (!tts) throw new JobError("Озвучка не настроена: Настройки → Озвучка (или FISH_* в .env)");
  return tts;
}

// Общие лимиты на все задачи сразу: прокси модели отдаёт 504 уже на трёх
// одновременных запросах, рендер MP4 занимает все ядра.
// ponytail: числа зашиты; вынести в настройки, если сменится провайдер.
const llmSlot = limiter(2);
const ttsSlot = limiter(2);
const renderSlot = limiter(1);
const mediaSlot = limiter(2);

const deps: PipelineDeps = {
  repo,
  events,
  storageDir: config.storageDir,
  generationContext: async (onProgress) => {
    const [llm, { search }, prefs] = await Promise.all([requireLlm(), providers.current(), loadPreferences(repo)]);
    const client = createOpenAiCompatibleClient(llm);
    return {
      llm: { askJson: (request) => llmSlot(() => client.askJson(request)) },
      today: todayIso(),
      concurrency: 2,
      onProgress,
      log: (m) => console.log(`  ${m}`),
      ...(search && prefs.research ? { firecrawlApiKey: search.apiKey } : {}),
    };
  },
  voice: async (narration, absPath) => {
    const tts = await requireTts();
    return ttsSlot(() => voiceNarration(narration, absPath, tts));
  },
  voiceKey: async () => {
    const { tts } = await providers.current();
    return tts ? `fish:${tts.model}:${tts.referenceId}` : "none";
  },
  render: async (manifest, outputPath, onProgress) => {
    await renderSlot(() => renderVideo({ manifest, outputPath, storageDir: config.storageDir, onProgress }));
  },
  // Обложка — один кадр за пару секунд: без лимита, иначе генерация стояла бы за чужим рендером.
  still: async (manifest, frame, output) => {
    await renderStills({ manifest, storageDir: config.storageDir, frames: [frame], outputPath: () => output });
  },
  mediaKey: async () => (await providers.current()).media?.apiKey,
  searchMedia: (input) => mediaSlot(() => searchPexels({ ...input, timeoutMs: 20000 })),
  downloadMedia: (url, dest) => mediaSlot(() => downloadPexelsMedia({ url, dest, timeoutMs: 60000 })),
};

/** «Проверить» в настройках: самый дешёвый запрос, который доказывает, что ключ рабочий. */
async function testProvider(kind: ProviderKind): Promise<{ ok: boolean; message: string }> {
  const current = await providers.current();
  if (kind === "llm") {
    const llm = await requireLlm();
    await createOpenAiCompatibleClient(llm).askJson({ system: 'Return JSON {"ok": true}.', user: "ping", maxTokens: 20, timeoutMs: 60000 });
    return { ok: true, message: `Модель ${llm.model} отвечает` };
  }
  if (kind === "tts") {
    const tts = await requireTts();
    const { words } = await synthesizeFish("Test.", { ...tts, timeoutMs: 60000 });
    return { ok: true, message: `Озвучка работает${words.length ? ", тайминги слов есть" : ", но без таймингов слов"}` };
  }
  if (kind === "search") {
    if (!current.search) return { ok: false, message: "Ключ поиска не задан" };
    const found = await searchSources({ query: "heat pump", apiKey: current.search.apiKey, limit: 1, timeoutMs: 60000 });
    return { ok: true, message: `Поиск работает: ${found.length} результат(ов)` };
  }
  if (!current.media) return { ok: false, message: "Ключ Pexels не задан" };
  const found = await searchPexels({ apiKey: current.media.apiKey, query: "nature", kind: "photo", orientation: "landscape", timeoutMs: 20000 });
  return { ok: true, message: `Pexels работает: ${found.length} результат(ов)` };
}

async function previewVoice(input: { text?: string; referenceId?: string; model?: string }): Promise<Buffer> {
  const tts = await requireTts();
  const { audio } = await synthesizeFish(input.text ?? "This is how your videos will sound.", {
    ...tts,
    ...(input.referenceId ? { referenceId: input.referenceId } : {}),
    ...(input.model ? { model: input.model } : {}),
    timeoutMs: 60000,
  });
  return Buffer.from(audio);
}

const worker = startWorker(deps, { concurrency: 3, log: (m) => console.error(m) });
const app = await buildApp({ ...deps, config, providers, testProvider, previewVoice, worker });
await app.listen({ host: config.host, port: config.port });
console.log(`Shorts Studio API: http://${config.host}:${config.port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await worker.stop();
    database.close();
    process.exit(0);
  });
}
