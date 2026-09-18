"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CreateForm } from "@/components/CreateForm";
import { ProjectTile } from "@/components/ProjectTile";
import { Topbar } from "@/components/Topbar";
import { Clapperboard, Search, TriangleAlert } from "lucide-react";
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

  const shelves = format
    ? [{ key: format, title: "", items }]
    : [
        { key: "shorts", title: "Shorts 9:16", items: items.filter((p) => p.format === "shorts") },
        { key: "landscape", title: "16:9", items: items.filter((p) => p.format === "landscape") },
      ].filter((s) => s.items.length > 0);

  return (
    <>
      <Topbar />
      <main className="page">
        {missing.length > 0 ? (
          <div className="notice" role="alert" style={{ marginBottom: 12 }}>
            <TriangleAlert size={14} strokeWidth={1.75} />
            <span>
              Чтобы создавать ролики, настройте {missing.join(" и ")} в <Link href="/settings" style={{ textDecoration: "underline" }}>Настройках</Link>.
              Ключи хранятся на этом компьютере, в браузер не передаются.
            </span>
          </div>
        ) : null}
        <CreateForm onCreated={() => void load()} />
        <div className="filters">
          <label className="search">
            <Search size={14} strokeWidth={1.75} />
            <input className="input" aria-label="Поиск" placeholder="Поиск по названию и теме" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select className="select" aria-label="Статус" value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus | "")}>
            <option value="">Все статусы</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <div className="seg" role="group" aria-label="Формат">
            {([["", "Все"], ["shorts", "9:16"], ["landscape", "16:9"]] as const).map(([value, label]) => (
              <button key={value} aria-pressed={format === value} onClick={() => setFormat(value)}>{label}</button>
            ))}
          </div>
          <div className="spacer" />
          {queued > 0 ? <span className="small muted">В очереди: <span className="mono">{queued}</span></span> : null}
          <span className="small muted"><span className="mono">{total}</span> {plural(total, "ролик", "ролика", "роликов")}</span>
        </div>
        {error ? <p className="error" style={{ marginTop: 16 }}>{error}</p> : null}
        {!error && items.length === 0 ? (
          search || status || format ? (
            <div className="empty"><p>Ничего не нашлось — измените поиск или фильтры.</p></div>
          ) : (
            <div className="empty">
              <Clapperboard size={28} strokeWidth={1.5} />
              <h2>Здесь появятся ролики</h2>
              <p>Впишите тему в строку выше: студия найдёт факты, напишет сценарий, соберёт кадры и озвучку.<br />Дальше каждую сцену можно поправить в редакторе.</p>
            </div>
          )
        ) : null}
        {shelves.map((shelf) => (
          <section key={shelf.key} aria-label={shelf.title || undefined}>
            {shelf.title ? <h2 className="shelf-title">{shelf.title} <span className="pill mono">{shelf.items.length}</span></h2> : <div style={{ height: 16 }} />}
            <div className={`grid${shelf.key === "landscape" ? " wide" : ""}`}>
              {shelf.items.map((project) => (
                <ProjectTile key={project.id} project={project} {...(jobs[project.id] ? { job: jobs[project.id] } : {})} onChange={() => void load()} />
              ))}
            </div>
          </section>
        ))}
        {items.length < total ? (
          <div className="row" style={{ justifyContent: "center", marginTop: 24 }}>
            <button className="btn" onClick={() => { limit.current += PAGE; void load(); }}>Показать ещё</button>
          </div>
        ) : null}
      </main>
    </>
  );
}
