/**
 * Человеческие названия всего, что в данных хранится кодом: типы кадра, подача,
 * блоки, поля. Одна таблица на весь интерфейс; неизвестное показывается как есть.
 */
import type { SceneIntent, SceneVisualSpec } from "@shorts/contracts";

export const KIND_LABEL: Record<SceneVisualSpec["kind"], string> = {
  composed: "Из блоков",
  "hook-statement": "Фраза",
  "stat-counter": "Счётчик",
  "icon-list": "Список с иконками",
  comparison: "Сравнение",
  "kinetic-text": "Строки",
  timeline: "Этапы",
  "outro-cta": "Финал",
};

export const BLOCK_LABEL: Record<string, string> = {
  heading: "Заголовок",
  caption: "Подпись",
  number: "Число",
  ring: "Кольцо",
  bars: "Столбцы",
  row: "Строка с иконкой",
  chips: "Метки",
  badge: "Плашка",
  icon: "Иконка",
  divider: "Разделитель",
  quote: "Цитата",
  pair: "Пара",
  chapter: "Глава",
};

export const INTENT_LABEL: Record<SceneIntent, string> = {
  hook: "Крючок",
  fact: "Факт",
  number: "Число",
  contrast: "Контраст",
  list: "Перечень",
  sequence: "Последовательность",
  punch: "Удар",
  takeaway: "Вывод",
};

export const FIELD_LABEL: Record<string, string> = {
  layout: "Раскладка",
  motion: "Появление",
  backdrop: "Фон",
  accentShift: "Сдвиг акцента",
  at: "Когда появится",
  emphasis: "Выделить",
  emphasisWords: "Выделить слова",
  emphasisLine: "Главная строка",
  text: "Текст",
  subtext: "Подтекст",
  title: "Заголовок",
  label: "Подпись",
  value: "Значение",
  unit: "Единица",
  decimals: "Знаков после запятой",
  fromValue: "От",
  toValue: "До",
  percent: "Процент",
  items: "Элементы",
  steps: "Этапы",
  lines: "Строки",
  icon: "Иконка",
  size: "Размер",
  variant: "Вид",
  kicker: "Надзаголовок",
  attribution: "Автор",
  index: "Номер",
  from: "От",
  glyph: "Символ",
};

/** Значения коротких перечислений; иконки остаются английскими — это имена. */
export const VALUE_LABEL: Record<string, Record<string, string>> = {
  layout: { center: "По центру", top: "Сверху", stacked: "Стопкой", left: "Слева", split: "Колонки" },
  motion: { rise: "Снизу", slide: "Сбоку", pop: "Масштаб", fade: "Проявление" },
  backdrop: { plain: "Чистый", grid: "Сетка", dots: "Точки", spotlight: "Пятно", rays: "Лучи" },
  size: { xl: "XL", l: "L", m: "M" },
  variant: { statement: "Утверждение", quote: "Цитата", line: "Линия", vs: "Против", arrow: "Стрелка" },
};

export const fieldLabel = (key: string): string => FIELD_LABEL[key] ?? key;
export const valueLabel = (field: string, value: string): string => VALUE_LABEL[field]?.[value] ?? value;
