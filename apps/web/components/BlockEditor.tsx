"use client";
/**
 * Ручная правка кадра. Черновик проверяется той же схемой формата, что и ответ
 * модели (visualSpecSchemaFor), — «не влезает в кадр: ~1180px из 1060px» видно
 * сразу, до сохранения и до экспорта.
 *
 * Редактор общий для всех типов: поля рисуются по значениям (строка, число,
 * флаг, список), для известных перечислений — выпадающие списки.
 */
import { useMemo, useState } from "react";
import {
  BLOCK_TYPES,
  IconNameSchema,
  SceneBackdropSchema,
  SceneLayoutSchema,
  SceneMotionKindSchema,
  visualSpecSchemaFor,
  type SceneVisualSpec,
  type VideoFormat,
} from "@shorts/contracts";

import { KIND_DEFAULTS, NEW_BLOCK, type Json } from "@/lib/visual-defaults";

const ENUMS: Record<string, readonly string[]> = {
  icon: IconNameSchema.options,
  motion: SceneMotionKindSchema.options,
  layout: SceneLayoutSchema.options,
  backdrop: SceneBackdropSchema.options,
  size: ["xl", "l", "m"],
  variant: ["statement", "quote", "line", "vs", "arrow"],
};
const HIDDEN = new Set(["kind", "block"]);

function FieldInput({ name, value, onChange }: { name: string; value: Json; onChange: (v: Json) => void }) {
  if (typeof value === "boolean") {
    return <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (typeof value === "number") {
    return <input className="input" type="number" step="any" value={value} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />;
  }
  if (typeof value === "string" && ENUMS[name]) {
    return (
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {ENUMS[name]!.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }
  if (typeof value === "string") {
    return <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
    return (
      <input
        className="input"
        value={(value as string[]).join(" | ")}
        title="Элементы через |"
        onChange={(e) => onChange(e.target.value.split("|").map((s) => s.trim()).filter(Boolean))}
      />
    );
  }
  if (Array.isArray(value)) {
    return (
      <div className="stack" style={{ gap: 6 }}>
        {value.map((item, i) => (
          <div key={i} className="block-card" style={{ padding: 8 }}>
            <ObjectFields value={item as { [key: string]: Json }} onChange={(next) => onChange(value.map((v, j) => (j === i ? next : v)))} />
            <button className="btn sm ghost danger" onClick={() => onChange(value.filter((_, j) => j !== i))}>Убрать</button>
          </div>
        ))}
        {value.length > 0 ? (
          <button className="btn sm ghost" onClick={() => onChange([...value, structuredClone(value[value.length - 1]!)])}>+ элемент</button>
        ) : null}
      </div>
    );
  }
  return <span className="muted small">—</span>;
}

function ObjectFields({ value, onChange }: { value: { [key: string]: Json }; onChange: (v: { [key: string]: Json }) => void }) {
  return (
    <>
      {Object.entries(value)
        .filter(([key]) => !HIDDEN.has(key))
        .map(([key, field]) => (
          <label key={key} className="field">
            <span className="muted">{key}</span>
            <FieldInput name={key} value={field} onChange={(next) => onChange({ ...value, [key]: next })} />
          </label>
        ))}
    </>
  );
}

export function BlockEditor({
  visual,
  format,
  saving,
  onSave,
}: {
  visual: SceneVisualSpec;
  format: VideoFormat;
  saving: boolean;
  onSave: (visual: unknown) => Promise<void>;
}) {
  const [draft, setDraft] = useState<{ [key: string]: Json }>(() => structuredClone(visual) as unknown as { [key: string]: Json });
  const [raw, setRaw] = useState<string>();
  const [serverIssues, setServerIssues] = useState<string[]>([]);
  const schema = useMemo(() => visualSpecSchemaFor(format), [format]);
  const result = schema.safeParse(draft);
  const issues = result.success ? [] : result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  const dirty = JSON.stringify(draft) !== JSON.stringify(visual);
  const blocks = Array.isArray(draft.blocks) ? (draft.blocks as { [key: string]: Json }[]) : undefined;
  const setBlocks = (next: { [key: string]: Json }[]) => setDraft({ ...draft, blocks: next });

  async function save() {
    try {
      setServerIssues([]);
      await onSave(draft);
    } catch (e) {
      const err = e as { issues?: { path: string; message: string }[]; message: string };
      setServerIssues(err.issues?.length ? err.issues.map((i) => `${i.path}: ${i.message}`) : [err.message]);
    }
  }

  if (raw !== undefined) {
    let parsedOk = true;
    try {
      JSON.parse(raw);
    } catch {
      parsedOk = false;
    }
    return (
      <div className="stack">
        <textarea className="textarea" style={{ minHeight: 320, fontFamily: "ui-monospace, monospace", fontSize: 12 }} value={raw} onChange={(e) => setRaw(e.target.value)} />
        <div className="row">
          <button className="btn sm" disabled={!parsedOk} onClick={() => { setDraft(JSON.parse(raw)); setRaw(undefined); }}>Применить JSON</button>
          <button className="btn sm ghost" onClick={() => setRaw(undefined)}>Отмена</button>
          {!parsedOk ? <span className="small error">Невалидный JSON</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="block-card">
        <label className="field">
          <span className="muted">тип кадра</span>
          <select
            className="select"
            value={String(draft.kind)}
            onChange={(e) => {
              const kind = e.target.value as SceneVisualSpec["kind"];
              const { layout, motion, backdrop, accentShift } = draft;
              // split бывает только у кадра из блоков.
              const safeLayout = kind !== "composed" && layout === "split" ? "center" : layout;
              setDraft({ ...structuredClone(KIND_DEFAULTS[kind]), layout: safeLayout ?? "center", motion: motion ?? "rise", backdrop: backdrop ?? "plain", accentShift: accentShift ?? 0 });
            }}
          >
            {Object.keys(KIND_DEFAULTS).map((kind) => (
              <option key={kind} value={kind}>{kind === "composed" ? "из блоков" : kind}</option>
            ))}
          </select>
        </label>
        <ObjectFields
          value={Object.fromEntries(Object.entries(draft).filter(([k]) => k !== "blocks"))}
          onChange={(next) => setDraft({ ...next, ...(blocks ? { blocks } : {}) })}
        />
      </div>
      {blocks
        ? blocks.map((block, i) => (
            <div key={i} className="block-card">
              <div className="row">
                <strong className="small">{String(block.block)}</strong>
                <div className="spacer" />
                <button className="btn sm ghost" disabled={i === 0} onClick={() => setBlocks(blocks.map((b, j) => (j === i - 1 ? blocks[i]! : j === i ? blocks[i - 1]! : b)))}>↑</button>
                <button className="btn sm ghost" disabled={i === blocks.length - 1} onClick={() => setBlocks(blocks.map((b, j) => (j === i + 1 ? blocks[i]! : j === i ? blocks[i + 1]! : b)))}>↓</button>
                <button className="btn sm ghost danger" onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}>✕</button>
              </div>
              <ObjectFields value={block} onChange={(next) => setBlocks(blocks.map((b, j) => (j === i ? next : b)))} />
            </div>
          ))
        : null}
      {blocks ? (
        <select
          className="select"
          value=""
          onChange={(e) => {
            const type = e.target.value as (typeof BLOCK_TYPES)[number];
            const last = blocks[blocks.length - 1];
            const at = typeof last?.at === "number" ? Math.min(0.75, last.at + 0.1) : 0;
            setBlocks([...blocks, { ...NEW_BLOCK[type], at: blocks.length === 0 ? 0 : at }]);
          }}
        >
          <option value="">+ добавить блок</option>
          {BLOCK_TYPES.filter((t) => t !== "chapter" || format === "landscape").map((type) => (
            <option key={type} value={type}>{type}</option>
          ))}
        </select>
      ) : null}
      {issues.length > 0 || serverIssues.length > 0 ? (
        <div className="issues">
          {[...issues, ...serverIssues].map((issue) => (
            <div key={issue}>{issue}</div>
          ))}
        </div>
      ) : null}
      <div className="row">
        <button className="btn primary" disabled={!dirty || issues.length > 0 || saving} onClick={() => void save()}>Сохранить кадр</button>
        <button className="btn ghost" disabled={!dirty} onClick={() => setDraft(structuredClone(visual) as unknown as { [key: string]: Json })}>Сбросить</button>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={() => setRaw(JSON.stringify(draft, null, 2))}>JSON</button>
      </div>
    </div>
  );
}
