import { z } from "zod";

/**
 * Подача сцены: композиция, характер движения и сдвиг акцента.
 *
 * Зачем отдельно от типа сцены: типов всего пять, и при одной композиции на тип
 * ролик из восьми сцен выглядит как восемь копий трёх шаблонов («все сцены
 * одинаковые»). Подача умножает пять типов на варианты, не добавляя ни одного
 * нового компонента и не давая модели писать код.
 *
 * Границы намеренно узкие — модель выбирает из закрытых enum, поэтому кадр
 * остаётся предсказуемым, а ролик стилистически цельным.
 */

/** Куда собирается контент сцены. */
export const SceneLayoutSchema = z.enum([
  /** По центру кадра — нейтральная подача. */
  "center",
  /** Прижат к верху зоны контента: под ним остаётся воздух, взгляд идёт сверху вниз. */
  "top",
  /** Крупный акцент сверху, поясняющая часть снизу. */
  "stacked",
  /** Контент смещён влево, с левой акцентной линией. */
  "left",
]);
export type SceneLayout = z.infer<typeof SceneLayoutSchema>;

/** Характер входа элементов. */
export const SceneMotionKindSchema = z.enum([
  /** Поднимается снизу. */
  "rise",
  /** Выезжает сбоку. */
  "slide",
  /** Появляется масштабом. */
  "pop",
  /** Проявляется без смещения. */
  "fade",
]);
export type SceneMotionKind = z.infer<typeof SceneMotionKindSchema>;

/**
 * Поля подачи, общие для всех базовых типов сцен.
 * Все с дефолтами: старые спеки и фикстуры остаются валидными.
 */
export const presentationFields = {
  layout: SceneLayoutSchema.default("center"),
  motion: SceneMotionKindSchema.default("rise"),
  /**
   * Сдвиг акцентного тона в градусах. Диапазон узкий: сцены различаются оттенком,
   * но не превращаются в набор разных брендов.
   */
  accentShift: z.number().int().min(-30).max(30).default(0),
};

export const PresentationSchema = z.object(presentationFields);
export type Presentation = z.infer<typeof PresentationSchema>;
