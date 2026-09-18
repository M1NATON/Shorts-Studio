import { z } from "zod";

/**
 * Данные для публикации ролика на YouTube — генерируются моделью вместе со
 * сценарием, чтобы пользователь не писал их отдельно руками.
 */
export const PublishMetaSchema = z.object({
  title: z.string().trim().min(10).max(100),
  description: z.string().trim().min(50).max(3000),
  hashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]{2,30}$/u)).min(3).max(8),
});
export type PublishMeta = z.infer<typeof PublishMetaSchema>;
