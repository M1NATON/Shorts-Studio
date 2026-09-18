import { defineConfig } from "vitest/config";

// Тесты веба — только чистая логика (lib/); компоненты проверяет e2e в браузере.
export default defineConfig({ test: { include: ["lib/**/*.test.ts"] } });
