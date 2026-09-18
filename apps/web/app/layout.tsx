import type { Metadata } from "next";
import Link from "next/link";
import { ThemeToggle } from "@/components/ThemeToggle";
import "./globals.css";

export const metadata: Metadata = { title: "Shorts Studio" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">Shorts Studio</Link>
          <nav className="nav">
            <Link href="/">Библиотека</Link>
            <Link href="/settings">Настройки</Link>
          </nav>
          <div className="spacer" />
          <ThemeToggle />
        </header>
        {children}
      </body>
    </html>
  );
}
