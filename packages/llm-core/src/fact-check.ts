/**
 * Проверка чисел ролика по источникам — кодом, без запроса к модели.
 *
 * Модель может взять цифру «из памяти», даже когда ей дали источники. Поэтому каждое
 * число из озвучки и из кадра ищется в текстах источников. Не нашлось — это не ошибка
 * (цифра могла быть посчитана: 9200 → 78 это «−99%»), а предупреждение, которое UI
 * показывает у сцены.
 */

export interface FoundNumber {
  /** Как число записано в тексте: "1,100", "90%", "$1.2 billion". */
  readonly raw: string;
  readonly value: number;
  /**
   * Шаг округления, с которым число записано: у "90" это 10, у "0.24" — 0.01.
   * «About 90%» при источнике 89% — честное округление, а не выдумка.
   */
  readonly step: number;
  readonly isYear: boolean;
  /** Число как записано, без множителя: у "2.03 billion" это 2.03. */
  readonly base: number;
  readonly baseStep: number;
  readonly scaled: boolean;
}

const SCALE: Record<string, number> = {
  thousand: 1e3,
  k: 1e3,
  million: 1e6,
  m: 1e6,
  mn: 1e6,
  billion: 1e9,
  bn: 1e9,
  b: 1e9,
  trillion: 1e12,
  t: 1e12,
};

const NUMBER_RE =
  /(?<![\p{L}\d.])(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s*(thousand|million|billion|trillion|bn|mn|k|m|b|t)(?![\p{L}]))?/giu;

/** Все числа из текста с их масштабом и точностью записи. */
export function extractNumbers(text: string): FoundNumber[] {
  const found: FoundNumber[] = [];
  for (const match of text.matchAll(NUMBER_RE)) {
    const [raw, whole = "", fraction, scaleWord] = match;
    const integer = whole.replace(/,/g, "");
    const base = Number(fraction ? `${integer}.${fraction}` : integer);
    if (!Number.isFinite(base)) continue;
    const scale = scaleWord ? (SCALE[scaleWord.toLowerCase()] ?? 1) : 1;

    let step: number;
    if (fraction) step = 10 ** -fraction.length;
    else {
      const trailingZeros = /0*$/.exec(integer)?.[0].length ?? 0;
      step = trailingZeros > 0 && trailingZeros < integer.length ? 10 ** trailingZeros : 1;
    }

    const isYear = !fraction && !scaleWord && integer.length === 4 && base >= 1800 && base <= 2100;
    found.push({
      raw: raw.trim(),
      value: base * scale,
      // Год проверяется точно: «2020» вместо «2023» — это другой факт.
      step: isYear ? 1 : step * scale,
      isYear,
      base,
      baseStep: isYear ? 1 : step,
      scaled: scale !== 1,
    });
  }
  return found;
}

/**
 * Числа, которые не стоит проверять: порядковые мелочи («3 reasons», «2 sides»)
 * есть в любом тексте и в любом источнике.
 */
const isTrivial = (n: FoundNumber): boolean => !n.isYear && Number.isInteger(n.value) && n.value <= 12 && n.step === 1;

/**
 * Число подтверждено, если в источниках есть значение в пределах его округления.
 *
 * Масштаб в кадре часто уходит в единицу: блок `number` с value 2.03 и unit "$B",
 * а в источнике «2.03 billion». Поэтому, когда масштаб записан только с одной
 * стороны, сравниваются числа как записаны.
 */
export function isSupported(claim: FoundNumber, sourceNumbers: readonly FoundNumber[]): boolean {
  const near = (a: number, b: number, step: number) => Math.abs(a - b) <= step / 2 + Math.abs(b) * 1e-9;
  return sourceNumbers.some((n) => {
    if (claim.isYear) return n.value === claim.value;
    if (near(n.value, claim.value, claim.step)) return true;
    return claim.scaled !== n.scaled && near(n.base, claim.base, claim.baseStep);
  });
}

/**
 * Неподтверждённые числа сцены. Числа в источниках извлекаются один раз на ролик:
 * передавайте результат `extractNumbers` по всем выжимкам.
 */
export function findUnsupportedNumbers(
  sceneTexts: readonly string[],
  sourceNumbers: readonly FoundNumber[],
): string[] {
  const unsupported = new Set<string>();
  for (const text of sceneTexts) {
    for (const claim of extractNumbers(text)) {
      if (isTrivial(claim)) continue;
      if (!isSupported(claim, sourceNumbers)) unsupported.add(claim.raw);
    }
  }
  return [...unsupported];
}

/**
 * Все строки и числа визуальной спеки — для проверки кадра, а не только озвучки.
 * Числовые поля (value, percent, toValue) превращаются в строки, чтобы пройти через
 * тот же разбор, что и текст.
 */
export function collectVisualTexts(visual: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown, key?: string) => {
    if (typeof node === "string") {
      if (!["kind", "block", "layout", "motion", "backdrop", "variant", "size", "icon"].includes(key ?? "")) {
        out.push(node);
      }
    } else if (typeof node === "number") {
      if (["value", "percent", "toValue"].includes(key ?? "")) out.push(String(node));
    } else if (Array.isArray(node)) {
      node.forEach((item) => walk(item, key));
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) walk(v, k);
    }
  };
  walk(visual);
  return out;
}
