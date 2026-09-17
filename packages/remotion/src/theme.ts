/** Токены тёмной темы из Plan.md §«Дизайн-токены тем». Один акцент на композицию. */
export const theme = {
  canvas: "#171817",
  surface: "#222421",
  surface2: "#2B2E2A",
  surface3: "#353934",
  border: "#424740",
  text: "#EEECE6",
  muted: "#A2A49B",
  accent: "#DCA268",
  accentSoft: "#44372B",
  success: "#91B59A",
  danger: "#E07A75",
} as const;

/** Safe zone для вертикального видео: элементы UI платформ не перекрывают контент. */
export const SAFE = { top: 220, bottom: 380, side: 80 } as const;

/**
 * Зона визуала сцены. Нижняя граница = SAFE.bottom + высота бокса субтитров:
 * иначе контент сцены оказывается под субтитрами и они читаются поверх друг друга.
 */
export const CONTENT = { top: SAFE.top, bottom: 640, side: SAFE.side } as const;

/** Инсет для корневого контейнера сцены — чтобы не повторять в каждом компоненте. */
export const CONTENT_INSET = `${CONTENT.top}px ${CONTENT.side}px ${CONTENT.bottom}px`;
