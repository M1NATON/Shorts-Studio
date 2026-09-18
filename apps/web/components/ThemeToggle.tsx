"use client";
import { useEffect, useState } from "react";

type Mode = "system" | "light" | "dark";
const NEXT: Record<Mode, Mode> = { system: "light", light: "dark", dark: "system" };
const LABEL: Record<Mode, string> = { system: "Тема: как в системе", light: "Тема: светлая", dark: "Тема: тёмная" };

/** Светлая/тёмная тема интерфейса. На ролик не влияет — у него своя тема из манифеста. */
export function ThemeToggle() {
  const [mode, setMode] = useState<Mode>("system");
  useEffect(() => {
    setMode((localStorage.getItem("ui-theme") as Mode | null) ?? "system");
  }, []);
  useEffect(() => {
    if (mode === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem("ui-theme", mode);
  }, [mode]);
  return (
    <button className="btn sm ghost" onClick={() => setMode(NEXT[mode])} aria-label={LABEL[mode]} title={LABEL[mode]}>
      {mode === "light" ? "☀" : mode === "dark" ? "☾" : "◐"}
    </button>
  );
}
