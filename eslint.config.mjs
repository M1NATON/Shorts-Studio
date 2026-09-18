// @ts-check
// Один конфиг на весь монорепозиторий: pnpm lint → eslint . из корня.
// Правила без проверки типов — типы уже проверяет pnpm typecheck.
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.next-e2e/**",
      "**/.turbo/**",
      "**/next-env.d.ts",
      "storage/**",
      "graphify-out/**",
      ".agents/**",
      "test-results/**",
      "playwright-report/**",
      "docs/**",
    ],
  },
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    // `const { drop, ...rest } = obj` — обычный способ выкинуть поле.
    rules: { "@typescript-eslint/no-unused-vars": ["error", { ignoreRestSiblings: true }] },
  },
  {
    // Скрипты запуска работают в Node.
    files: ["scripts/**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly", setTimeout: "readonly", fetch: "readonly" } },
  },
);
