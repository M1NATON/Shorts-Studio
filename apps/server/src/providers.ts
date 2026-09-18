/**
 * Провайдеры (модель, озвучка, поиск): значения из UI поверх .env.
 *
 * Ключи хранятся в базе (storage/, в .gitignore) и читаются только здесь. Наружу —
 * в API, логи и ошибки — уходит маска «••••1234». Тест на это есть в app.test.ts.
 */
import type { Repository } from "@shorts/db";
import { z } from "zod";
import type { ServerConfig } from "./config.js";

export const LlmSettingsSchema = z.object({
  baseUrl: z.string().trim().url().max(300),
  apiKey: z.string().trim().min(1).max(500),
  model: z.string().trim().min(1).max(200),
});
export const TtsSettingsSchema = z.object({
  apiKey: z.string().trim().min(1).max(500),
  model: z.string().trim().min(1).max(200),
  referenceId: z.string().trim().min(1).max(200),
});
export const SearchSettingsSchema = z.object({ apiKey: z.string().trim().min(1).max(500) });

export type LlmSettings = z.infer<typeof LlmSettingsSchema>;
export type TtsSettings = z.infer<typeof TtsSettingsSchema>;
export type SearchSettings = z.infer<typeof SearchSettingsSchema>;
export type ProviderKind = "llm" | "tts" | "search";

export interface Providers {
  readonly llm?: LlmSettings;
  readonly tts?: TtsSettings;
  readonly search?: SearchSettings;
}

const SCHEMAS = { llm: LlmSettingsSchema, tts: TtsSettingsSchema, search: SearchSettingsSchema } as const;
const KEY = (kind: ProviderKind) => `provider.${kind}`;

/** «••••1234» — последние 4 символа только у длинного ключа, иначе одна маска. */
export function maskKey(key: string | undefined): string | null {
  if (!key) return null;
  return key.length >= 12 ? `••••${key.slice(-4)}` : "••••";
}

export interface ProviderStore {
  /** Действующие настройки: сохранённые в UI, иначе из .env. */
  current(): Promise<Providers>;
  /** Сохранить; пустой apiKey — оставить прежний (форма не знает его значения). */
  save(kind: ProviderKind, input: Record<string, unknown>): Promise<void>;
  /** Что видит UI: без значений ключей. */
  describe(): Promise<Record<ProviderKind, { configured: boolean; source: "ui" | "env" | null; fields: Record<string, string | null> }>>;
}

export function createProviderStore(repo: Repository, config: ServerConfig): ProviderStore {
  const fromEnv: Providers = {
    ...(config.llm ? { llm: config.llm } : {}),
    ...(config.fish ? { tts: config.fish } : {}),
    ...(config.firecrawlApiKey ? { search: { apiKey: config.firecrawlApiKey } } : {}),
  };

  async function stored(kind: ProviderKind) {
    const raw = await repo.getSetting<unknown>(KEY(kind));
    const parsed = raw === undefined ? undefined : SCHEMAS[kind].safeParse(raw);
    return parsed?.success ? parsed.data : undefined;
  }

  async function current(): Promise<Providers> {
    const [llm, tts, search] = await Promise.all([stored("llm"), stored("tts"), stored("search")]);
    const pick = <T>(ui: T | undefined, env: T | undefined) => ui ?? env;
    const result: { llm?: LlmSettings; tts?: TtsSettings; search?: SearchSettings } = {};
    const l = pick(llm as LlmSettings | undefined, fromEnv.llm);
    const t = pick(tts as TtsSettings | undefined, fromEnv.tts);
    const s = pick(search as SearchSettings | undefined, fromEnv.search);
    if (l) result.llm = l;
    if (t) result.tts = t;
    if (s) result.search = s;
    return result;
  }

  return {
    current,
    async save(kind, input) {
      const previous = ((await current())[kind] ?? {}) as Record<string, unknown>;
      const apiKey = typeof input.apiKey === "string" && input.apiKey.trim() ? input.apiKey : previous.apiKey;
      const value = SCHEMAS[kind].parse({ ...previous, ...input, apiKey });
      await repo.setSetting(KEY(kind), value);
    },
    async describe() {
      const now = await current();
      const out = {} as Awaited<ReturnType<ProviderStore["describe"]>>;
      for (const kind of ["llm", "tts", "search"] as const) {
        const value = now[kind] as Record<string, string> | undefined;
        const source = (await stored(kind)) ? "ui" : fromEnv[kind] ? "env" : null;
        const fields: Record<string, string | null> = {};
        for (const field of Object.keys(SCHEMAS[kind].shape)) {
          fields[field] = field === "apiKey" ? maskKey(value?.apiKey) : (value?.[field] ?? null);
        }
        out[kind] = { configured: Boolean(value), source, fields };
      }
      return out;
    },
  };
}
