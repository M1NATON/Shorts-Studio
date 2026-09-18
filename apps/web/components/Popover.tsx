"use client";
import { useEffect, useRef, useState } from "react";

/** Кнопка со всплывающим слоем: закрывается кликом мимо и Escape. */
export function Popover({
  button,
  label,
  className = "btn",
  menuClass = "menu",
  children,
}: {
  button: React.ReactNode;
  label?: string;
  className?: string;
  menuClass?: string;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="popover" ref={root}>
      <button type="button" className={className} aria-expanded={open} aria-haspopup="true" aria-label={label} title={label} onClick={() => setOpen((v) => !v)}>
        {button}
      </button>
      {open ? <div className={menuClass}>{children(() => setOpen(false))}</div> : null}
    </div>
  );
}
