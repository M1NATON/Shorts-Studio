"use client";
import { useEffect, useRef, useState } from "react";
import { Check, PlugZap, Volume2 } from "lucide-react";
import { Topbar } from "@/components/Topbar";
import { api, ApiError, type ProviderInfo, type ProviderKind } from "@/lib/api";

const PROVIDERS: { kind: ProviderKind; title: string; hint: string; fields: { name: string; label: string; placeholder?: string }[] }[] = [
  {
    kind: "llm",
    title: "Модель — сценарий и кадры",
    hint: "Любой OpenAI-совместимый endpoint: свой baseUrl, ключ и модель.",
    fields: [
      { name: "baseUrl", label: "Base URL", placeholder: "https://api.openai.com/v1" },
      { name: "model", label: "Модель" },
      { name: "apiKey", label: "API key" },
    ],
  },
  {
    kind: "tts",
    title: "Озвучка — Fish Audio",
    hint: "Голос задаётся reference id. Смена голоса — новая озвучка сцен при следующей подготовке.",
    fields: [
      { name: "model", label: "Модель" },
      { name: "referenceId", label: "Голос (reference id)" },
      { name: "apiKey", label: "API key" },
    ],
  },
  {
    kind: "search",
    title: "Поиск фактов — Firecrawl",
    hint: "Без поиска факты берутся только из знаний модели и не проверяются по источникам.",
    fields: [{ name: "apiKey", label: "API key" }],
  },
];

/**
 * Провайдеры. Ключ уходит на сервер и хранится там; обратно приходит только
 * маска. Пустое поле ключа при сохранении — «оставить прежний».
 */
function ProviderForm({ spec, info, onSaved }: { spec: (typeof PROVIDERS)[number]; info: ProviderInfo; onSaved: (i: ProviderInfo) => void }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(spec.fields.map((f) => [f.name, f.name === "apiKey" ? "" : (info.fields[f.name] ?? "")])),
  );
  const [status, setStatus] = useState<{ ok: boolean; message: string }>();
  const [busy, setBusy] = useState(false);
  const player = useRef<HTMLAudioElement | null>(null);

  /** Образец голоса из формы — до сохранения, чтобы выбирать голос на слух. */
  async function listen() {
    setBusy(true);
    setStatus(undefined);
    try {
      const blob = await api.previewVoice({
        ...(values.referenceId?.trim() ? { referenceId: values.referenceId.trim() } : {}),
        ...(values.model?.trim() ? { model: values.model.trim() } : {}),
      });
      if (player.current) URL.revokeObjectURL(player.current.src);
      player.current = new Audio(URL.createObjectURL(blob));
      await player.current.play();
    } catch (e) {
      setStatus({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setStatus(undefined);
    try {
      const next = await api.saveSettings(spec.kind, values);
      setValues((v) => ({ ...v, apiKey: "" }));
      onSaved(next);
      setStatus({ ok: true, message: "Сохранено" });
    } catch (e) {
      setStatus({ ok: false, message: e instanceof ApiError && e.issues.length ? e.issues.map((i) => `${i.path}: ${i.message}`).join("; ") : (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setStatus(undefined);
    try {
      setStatus(await api.testSettings(spec.kind));
    } finally {
      setBusy(false);
    }
  }

  const state = info.configured ? (info.source === "ui" ? "задано здесь" : "из .env") : "не задано";
  return (
    <section aria-labelledby={`p-${spec.kind}`}>
      <div className="row">
        <h2 id={`p-${spec.kind}`}>{spec.title}</h2>
        <span className={`status small ${info.configured ? "ready" : "failed"}`}>{state}</span>
      </div>
      <p className="small muted">{spec.hint}</p>
      {spec.fields.map((field) => (
        <label key={field.name} className="field">
          <span>{field.label}</span>
          <input
            className="input"
            type={field.name === "apiKey" ? "password" : "text"}
            autoComplete="off"
            placeholder={field.name === "apiKey" ? (info.fields.apiKey ? `${info.fields.apiKey} — оставьте пустым, чтобы не менять` : "не задан") : field.placeholder}
            value={values[field.name] ?? ""}
            onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
          />
        </label>
      ))}
      <div className="row" style={{ paddingLeft: 188 }}>
        <button className="btn pri" disabled={busy} onClick={() => void save()}>Сохранить</button>
        <button className="btn" disabled={busy || !info.configured} onClick={() => void test()}>
          <PlugZap size={16} strokeWidth={1.75} />Проверить
        </button>
        {spec.kind === "tts" ? (
          <button className="btn" disabled={busy || !info.configured} onClick={() => void listen()} title="Короткая фраза этим голосом; сохранять не нужно">
            <Volume2 size={16} strokeWidth={1.75} />Прослушать
          </button>
        ) : null}
        {status ? (
          <span className={`small row ${status.ok ? "" : "error"}`} style={{ gap: 4 }} role="status">
            {status.ok ? <Check size={14} strokeWidth={2} style={{ color: "var(--ok)" }} /> : null}
            {status.message}
          </span>
        ) : null}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const [data, setData] = useState<Record<ProviderKind, ProviderInfo>>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    api.settings().then(setData).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <Topbar title="Настройки" />
      <main className="settings">
        <h1>Провайдеры</h1>
        <p className="lead">
          Ключи хранятся только на сервере (в базе в <code>storage/</code>) и в браузер не передаются — здесь видна только маска.
          Значения из <code>.env</code> действуют, пока их не заменили здесь.
        </p>
        {error ? <p className="error">{error}</p> : null}
        {data
          ? PROVIDERS.map((spec) => (
              <ProviderForm key={spec.kind} spec={spec} info={data[spec.kind]} onSaved={(info) => setData({ ...data, [spec.kind]: info })} />
            ))
          : null}
      </main>
    </>
  );
}
