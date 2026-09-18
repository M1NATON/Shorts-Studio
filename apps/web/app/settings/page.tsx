"use client";
import { useEffect, useState } from "react";
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

  return (
    <section className="card stack" style={{ padding: 16 }} aria-labelledby={`p-${spec.kind}`}>
      <div className="row">
        <h3 id={`p-${spec.kind}`} style={{ margin: 0, fontSize: 15 }}>{spec.title}</h3>
        <span className={`badge ${info.configured ? "ready" : "failed"}`}>
          {info.configured ? (info.source === "ui" ? "настроено здесь" : "из .env") : "не настроено"}
        </span>
      </div>
      <p className="small muted" style={{ margin: 0 }}>{spec.hint}</p>
      {spec.fields.map((field) => (
        <label key={field.name} className="field" style={{ gridTemplateColumns: "180px 1fr" }}>
          <span className="muted">{field.label}</span>
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
      <div className="row">
        <button className="btn primary" disabled={busy} onClick={() => void save()}>Сохранить</button>
        <button className="btn" disabled={busy || !info.configured} onClick={() => void test()}>Проверить</button>
        {status ? <span className={`small ${status.ok ? "" : "error"}`} role="status">{status.ok ? "✓ " : ""}{status.message}</span> : null}
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
    <main className="page stack" style={{ maxWidth: 760 }}>
      <h2 style={{ marginBottom: 0 }}>Провайдеры</h2>
      <p className="muted" style={{ marginTop: 0 }}>
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
  );
}
