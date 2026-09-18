import { z } from "zod";

/**
 * Фото или видео сцены с Pexels. Принадлежит сцене, а не версии текста:
 * переписывание/переозвучка не теряют картинку (см. packages/db/src/repository.ts).
 */
export const SceneMediaSchema = z.object({
  kind: z.enum(["photo", "video"]),
  query: z.string().trim().min(2).max(80),
  /** Путь относительно storage: projects/<id>/media/<file>. */
  src: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Только для видео. */
  durationSec: z.number().positive().optional(),
  pexelsId: z.number().int(),
  credit: z.object({ name: z.string().min(1), url: z.string().url() }),
});
export type SceneMedia = z.infer<typeof SceneMediaSchema>;
