import type { NextConfig } from "next";

/**
 * API и файлы проектов живут на локальном сервере (apps/server). Браузер ходит
 * к ним через тот же origin — без CORS, а ключи провайдеров остаются на сервере.
 */
const API = process.env.STUDIO_API_URL ?? "http://127.0.0.1:3001";

const config: NextConfig = {
  // Отдельный каталог сборки для e2e: иначе dev-сервер теста затирает боевую сборку.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // Правила для агентов лежат в корневом AGENTS.md; свои Next генерировать не должен.
  agentRules: false,
  // Dev-сервер отдаёт HMR только своему origin; без этого по 127.0.0.1 страница
  // не гидратировалась (а localhost и 127.0.0.1 для него разные origin).
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API}/api/:path*` },
      // staticFile() в плеере даёт "/projects/<id>/audio/<hash>.wav".
      { source: "/projects/:path*", destination: `${API}/projects/:path*` },
      // Фоновая музыка: "/music/<файл>" из storage/music.
      { source: "/music/:path*", destination: `${API}/music/:path*` },
      // Звуки склеек: "/sfx/<файл>" из storage/sfx.
      { source: "/sfx/:path*", destination: `${API}/sfx/:path*` },
    ];
  },
};

export default config;
