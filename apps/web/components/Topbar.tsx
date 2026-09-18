import Link from "next/link";
import { Settings } from "lucide-react";
import { ThemeToggle } from "./ThemeToggle";

/** Шапка: знак, хлебные крошки, действия страницы, настройки и тема. */
export function Topbar({ title, children }: { title?: string; children?: React.ReactNode }) {
  return (
    <header className="topbar">
      <Link href="/" className="brand">Studio</Link>
      <nav className="crumbs" aria-label="Навигация">
        {title ? (
          <>
            <Link href="/">Библиотека</Link>
            <span className="sep">/</span>
            <span aria-current="page" title={title}>{title}</span>
          </>
        ) : (
          <span aria-current="page">Библиотека</span>
        )}
      </nav>
      <div className="spacer" />
      <div className="page-actions">{children}</div>
      <Link href="/settings" className="btn ghost icon" aria-label="Настройки" title="Настройки">
        <Settings size={16} strokeWidth={1.75} />
      </Link>
      <ThemeToggle />
    </header>
  );
}
