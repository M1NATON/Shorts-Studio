"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CreateForm } from "@/components/CreateForm";
import { ProjectTile } from "@/components/ProjectTile";
import { api, type Job, type Project, type ProjectStatus } from "@/lib/api";
import { useStudioEvents } from "@/lib/events";
import { plural, STATUS_LABEL } from "@/lib/format";

const PAGE = 36;

/** Библиотека — главный экран: роликов будут сотни, поэтому поиск, фильтры и подгрузка. */
export default function LibraryPage() {
  const [items, setItems] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProjectStatus | "">("");
  const [format, setFormat] = useState<"" | "shorts" | "landscape">("");
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [error, setError] = useState<string>();
  const limit = useRef(PAGE);
  // Первый запуск: без модели и озвучки ролик не собрать — сразу ведём в Настройки.
  const [missing, setMissing] = useState<string[]>([]);
  useEffect(() => {
    api.settings().then((s) => setMissing([
      ...(s.llm.configured ? [] : ["модель"]),
      ...(s.tts.configured ? [] : ["озвучку"]),
    ])).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await api.listProjects({ search, status, format, limit: limit.current });
      setItems(res.items);
      setTotal(res.total);
      setError(undefined);
    } catch (e) {
      setError(`Сервер недоступен: ${(e as Error).message}. Запустите apps/server.`);
    }
  }, [search, status, format]);

  useEffect(() => {
    limit.current = PAGE;
    const timer = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    api.jobs(undefined, true).then((list) => {
      setJobs(Object.fromEntries(list.filter((j) => j.projectId).map((j) => [j.projectId!, j])));
    }).catch(() => undefined);
  }, []);

  useStudioEvents((event) => {
    if (event.type === "job" && event.job.projectId) {
      setJobs((prev) => ({ ...prev, [event.job.projectId!]: event.job }));
      if (event.job.status === "done" || event.job.status === "failed") void load();
    }
    if (event.type === "project") void load();
  });

  const queued = Object.values(jobs).filter((j) => j.status === "queued").length;

  return (
    <main className="page">
      {missing.length > 0 ? (
        <p className="card" role="alert" style={{ padding: 12 }}>
          Чтобы создавать ролики, настройте {missing.join(" и ")}: <Link href="/settings">Настройки → Провайдеры</Link>.
          Ключи хранятся на этом компьютере, в браузер не передаются.
        </p>
      ) : null}
      <CreateForm onCreated={() => void load()} />
      <div className="row" style={{ marginBottom: 18 }}>
        <input className="input" style={{ minWidth: 280 }} placeholder="Поиск по названию и теме" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="select" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus | "")}>
          <option value="">Все статусы</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <div className="seg">
          {([["", "Все"], ["shorts", "9:16"], ["landscape", "16:9"]] as const).map(([value, label]) => (
            <button key={value} className={format === value ? "on" : ""} onClick={() => setFormat(value)}>{label}</button>
          ))}
        </div>
        <div className="spacer" />
        {queued > 0 ? <span className="small muted">В очереди: {queued}</span> : null}
        <span className="small muted">{total} {plural(total, "ролик", "ролика", "роликов")}</span>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {!error && items.length === 0 ? <p className="muted">Пока пусто. Введите тему выше — ролик появится здесь.</p> : null}
      <div className="grid">
        {items.map((project) => (
          <ProjectTile key={project.id} project={project} {...(jobs[project.id] ? { job: jobs[project.id] } : {})} onChange={() => void load()} />
        ))}
      </div>
      {items.length < total ? (
        <div className="row" style={{ justifyContent: "center", marginTop: 24 }}>
          <button className="btn" onClick={() => { limit.current += PAGE; void load(); }}>Показать ещё</button>
        </div>
      ) : null}
    </main>
  );
}
