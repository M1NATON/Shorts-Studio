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
