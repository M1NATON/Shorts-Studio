import React from "react";
import * as Lucide from "lucide-react";
import type { IconName } from "@shorts/contracts";

/**
 * Мост между закрытым enum IconName в контрактах и пакетом иконок.
 * kebab-case → PascalCase: "trending-up" → TrendingUp.
 * Соответствие проверяется тестом icon-registry.test.ts: если имя из схемы
 * не существует в lucide, тест падает, а не сцена рендерится с дырой.
 */
const toPascal = (name: string): string =>
  name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

type LucideIcon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

export function resolveIcon(name: IconName): LucideIcon | undefined {
  return (Lucide as unknown as Record<string, LucideIcon>)[toPascal(name)];
}

export const Icon: React.FC<{ name: IconName; size?: number; color?: string }> = ({
  name,
  size = 64,
  color,
}) => {
  const Component = resolveIcon(name);
  if (!Component) return null;
  return <Component size={size} color={color} strokeWidth={1.8} />;
};
