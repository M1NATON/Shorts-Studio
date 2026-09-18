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
 * Фактура фона сцены.
 *
 * Композиция и движение меняют то, КАК приходит контент, но кадр всё равно
 * оставался одинаковым: тёмный фон плюс текст. Фактура меняет саму картинку,
 * не трогая контент и не требуя новых типов сцен.
 */
export const SceneBackdropSchema = z.enum([
  /** Чистый фон — когда важен только текст. */
  "plain",
  /** Техническая сетка: данные, инфраструктура, инженерия. */
  "grid",
  /** Точечный растр: перечисления и списки. */
  "dots",
  /** Световое пятно за объектом: одно число, один акцент. */
  "spotlight",
  /** Диагональные полосы: сравнение и противопоставление. */
  "rays",
]);
export type SceneBackdrop = z.infer<typeof SceneBackdropSchema>;

/**
 * Поля подачи, общие для всех базовых типов сцен.
 * Все с дефолтами: старые спеки и фикстуры остаются валидными.
 */
export const presentationFields = {
  layout: SceneLayoutSchema.default("center"),
  motion: SceneMotionKindSchema.default("rise"),
  backdrop: SceneBackdropSchema.default("plain"),
  /**
   * Сдвиг акцентного тона в градусах. Диапазон узкий: сцены различаются оттенком,
   * но не превращаются в набор разных брендов.
   */
  accentShift: z.number().int().min(-30).max(30).default(0),
};

export const PresentationSchema = z.object(presentationFields);
export type Presentation = z.infer<typeof PresentationSchema>;

/**
 * Зона визуала сцены в кадре 1080×1920. Нижняя граница = safe zone платформы
 * + бокс субтитров: иначе контент уходит под субтитры.
 *
 * Живёт в контрактах, а не в рендере: по этим же числам валидатор композиции
 * считает, влезает ли сцена в кадр, до того как её увидит Remotion.
 */
export const SCENE_ZONE = { top: 220, bottom: 640, side: 80 } as const;

/**
 * Сдвиг оптического центра по композиции. Прямой justifyContent: flex-start
 * оставлял под контентом 600px пустоты, поэтому "top" и "stacked" центрируют
 * контент в подобласти зоны, а не прижимают его к краю.
 */
export const LAYOUT_ZONE_PADDING: Record<SceneLayout, { top: number; bottom: number; left: number }> = {
  center: { top: 0, bottom: 0, left: 0 },
  top: { top: 0, bottom: 240, left: 0 },
  stacked: { top: 300, bottom: 0, left: 0 },
  // Левая акцентная линия (6px) и отступ текста от неё (26px).
  left: { top: 0, bottom: 0, left: 32 },
};
