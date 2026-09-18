"use client";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";

type Mode = "system" | "light" | "dark";
const NEXT: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Mode, string> = { system: "Тема: как в системе", light: "Тема: светлая", dark: "Тема: тёмная" };
const ICON = { system: Monitor, light: Sun, dark: Moon };

/** Светлая/тёмная тема интерфейса. На ролик не влияет — у него своя тема из манифеста. */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    setMode((localStorage.getItem("ui-theme") as Mode | null) ?? "system");
  }, []);
  function change(next: Mode) {
    setMode(next);
    if (next === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("ui-theme", next);
  }
  const Icon = ICON[mode];
  return (
    <button className="btn ghost icon" onClick={() => change(NEXT[mode])} aria-label={LABEL[mode]} title={LABEL[mode]}>
      <Icon size={16} strokeWidth={1.75} />
    </button>
  );
}
