"use client";
import { useEffect, useRef, useState } from "react";
import type { CaptionStyle, VideoFormat } from "@shorts/contracts";
import { api, ApiError, type Preferences, type ProviderInfo, type ProviderKind } from "@/lib/api";
import { CAPTION_LABEL, MINUTES_OPTIONS } from "@/lib/format";

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
        {spec.kind === "tts" ? (
          <button className="btn" disabled={busy || !info.configured} onClick={() => void listen()} title="Короткая фраза этим голосом; сохранять не нужно">
            Прослушать
          </button>
        ) : null}
        {status ? <span className={`small ${status.ok ? "" : "error"}`} role="status">{status.ok ? "✓ " : ""}{status.message}</span> : null}
      </div>
    </section>
  );
}

/** Предпочтения: чем заполнена форма нового ролика. Сохраняются сразу при изменении. */
function PreferencesForm({ searchConfigured }: { searchConfigured: boolean }) {
  const [prefs, setPrefs] = useState<Preferences>();
  const [status, setStatus] = useState<{ ok: boolean; message: string }>();
  useEffect(() => {
    api.preferences().then(setPrefs).catch((e: Error) => setStatus({ ok: false, message: e.message }));
  }, []);

  async function change(patch: Partial<Preferences>) {
    try {
      setPrefs(await api.savePreferences(patch));
      setStatus({ ok: true, message: "Сохранено" });
    } catch (e) {
      setStatus({ ok: false, message: (e as Error).message });
    }
  }

  if (!prefs) return status ? <p className="error">{status.message}</p> : null;
  const labelStyle = { gridTemplateColumns: "180px 1fr" };
  return (
    <section className="card stack" style={{ padding: 16 }} aria-labelledby="prefs">
      <h3 id="prefs" style={{ margin: 0, fontSize: 15 }}>Новые ролики по умолчанию</h3>
      <p className="small muted" style={{ margin: 0 }}>Форма создания открывается с этими значениями; для одного ролика их можно поменять там же.</p>
      <label className="field" style={labelStyle}>
        <span className="muted">Формат</span>
        <select className="select" value={prefs.format} onChange={(e) => void change({ format: e.target.value as VideoFormat })}>
          <option value="shorts">Shorts 9:16</option>
          <option value="landscape">Длинный 16:9</option>
        </select>
      </label>
      <label className="field" style={labelStyle}>
        <span className="muted">Длина 16:9</span>
        <select className="select" value={prefs.minutes} onChange={(e) => void change({ minutes: Number(e.target.value) })}>
          {MINUTES_OPTIONS.map((m) => (
            <option key={m} value={m}>{m} мин</option>
          ))}
        </select>
      </label>
      <label className="field" style={labelStyle}>
        <span className="muted">Субтитры</span>
        <select className="select" value={prefs.captionStyle} onChange={(e) => void change({ captionStyle: e.target.value as CaptionStyle })}>
          {Object.entries(CAPTION_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label className="field" style={labelStyle}>
        <span className="muted">Факты</span>
        <select className="select" value={prefs.freshness} onChange={(e) => void change({ freshness: e.target.value as Preferences["freshness"] })}>
          <option value="auto">авто — решает модель по теме</option>
          <option value="current">свежие (новости за год)</option>
          <option value="evergreen">вечнозелёные</option>
        </select>
      </label>
      <label className="field" style={labelStyle}>
        <span className="muted">Поиск источников</span>
        <span className="row small">
          <input type="checkbox" checked={prefs.research} onChange={(e) => void change({ research: e.target.checked })} />
          {searchConfigured ? "искать факты в сети (Firecrawl)" : "ключ Firecrawl не задан — поиск не работает"}
        </span>
      </label>
      {status ? <span className={`small ${status.ok ? "" : "error"}`} role="status">{status.ok ? "✓ " : ""}{status.message}</span> : null}
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
      <h2 style={{ marginBottom: 0 }}>Настройки</h2>
      {data ? <PreferencesForm searchConfigured={data.search.configured} /> : null}
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
