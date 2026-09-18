import { z } from "zod";

/**
 * Закрытый список иконок. LLM видит только его (промпт генерируется из схемы),
 * поэтому не может попросить несуществующую иконку.
 * Имена — kebab-case из lucide; соответствие реальному пакету закреплено тестом
 * в @shorts/remotion (icon-registry.test.ts).
 */
export const IconNameSchema = z.enum([
  "activity", "alarm-clock", "atom", "battery", "book-open", "brain", "building-2",
  "calendar", "chart-column", "chart-line", "circle-check", "circle-x", "clock", "coins",
  "cpu", "database", "dollar-sign", "droplet", "eye", "factory", "flame", "globe",
  "graduation-cap", "heart", "leaf", "lightbulb", "lock", "map-pin", "microscope", "moon",
  "percent", "plane", "rocket", "scale", "search", "shield", "smartphone", "sparkles",
  "sun", "target", "thermometer", "timer", "trending-down", "trending-up", "triangle-alert",
  "truck", "users", "wifi", "wrench", "zap",
]);
export type IconName = z.infer<typeof IconNameSchema>;
