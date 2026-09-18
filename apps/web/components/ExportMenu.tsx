"use client";
import { useState } from "react";
import { Copy, FileDown } from "lucide-react";
import type { Project, Scene } from "@/lib/api";
import { exportJson, exportMarkdown } from "@/lib/export";

const ICON = { size: 16, strokeWidth: 1.75 } as const;

/** Имя файла из заголовка: только латиница/цифры/дефис, иначе "video". */
function filenameBase(title: string): string {
  const cleaned = title.replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned || "video";
}

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Экспорт содержимого ролика — для проверки фактов сторонней нейросетью. */
export function ExportMenu({ project, scenes }: { project: Project; scenes: Scene[] }) {
  const [copied, setCopied] = useState(false);
  const name = filenameBase(project.title ?? project.topic);

  const copyForCheck = async () => {
    const md = exportMarkdown(project, scenes);
    if (!navigator.clipboard) {
      download(`${name}.md`, md, "text/markdown");
      return;
    }
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      download(`${name}.md`, md, "text/markdown");
    }
  };

  return (
    <>
      <button type="button" onClick={() => void copyForCheck()}>
        <Copy {...ICON} />
        <span role="status">{copied ? "Скопировано" : "Скопировать для проверки"}</span>
      </button>
      <button type="button" onClick={() => download(`${name}.md`, exportMarkdown(project, scenes), "text/markdown")}>
        <FileDown {...ICON} />Скачать .md
      </button>
      <button type="button" onClick={() => download(`${name}.json`, exportJson(project, scenes), "application/json")}>
        <FileDown {...ICON} />Скачать .json
      </button>
    </>
  );
}
