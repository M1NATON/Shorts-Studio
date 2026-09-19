/**
 * Числа словами — только для текста, который уходит в TTS; субтитры остаются с цифрами.
 *
 * Fish читает "1900" и "2,000" неверно (по цифрам или с разрывом на запятой),
 * поэтому год и количество проговариваем сами: 1900 → "nineteen hundred",
 * 2,000 → "two thousand". Правило английского письма: год пишется без запятой,
 * количество от тысячи — с запятой; 4 цифры без запятой в 1100–2099 читаем как год.
 */
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion", "trillion"];

function belowHundred(n: number): string {
  if (n < 20) return ONES[n]!;
  const tens = TENS[Math.floor(n / 10)]!;
  return n % 10 ? `${tens}-${ONES[n % 10]}` : tens;
}

function belowThousand(n: number): string {
  const rest = n % 100;
  if (n < 100) return belowHundred(n);
  return `${ONES[Math.floor(n / 100)]} hundred${rest ? ` ${belowHundred(rest)}` : ""}`;
}

function cardinal(digits: string): string {
  if (/^0+$/.test(digits)) return "zero";
  const groups: number[] = [];
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(Number(digits.slice(Math.max(0, end - 3), end)));
  if (groups.length > SCALES.length) return digits.split("").map((d) => ONES[Number(d)]).join(" ");
  return groups
    .map((g, i) => (g ? `${belowThousand(g)}${SCALES[groups.length - 1 - i] ? ` ${SCALES[groups.length - 1 - i]}` : ""}` : ""))
    .filter(Boolean)
    .join(" ");
}

function year(n: number): string {
  if (n >= 2000 && n < 2010) return cardinal(String(n));
  const hi = Math.floor(n / 100);
  const lo = n % 100;
  const head = belowHundred(hi);
  if (lo === 0) return `${head} hundred`;
  return lo < 10 ? `${head} oh ${ONES[lo]}` : `${head} ${belowHundred(lo)}`;
}

/** "1980s" → "nineteen eighties", "1900s" → "nineteen hundreds". */
const plural = (words: string): string => (words.endsWith("y") ? `${words.slice(0, -1)}ies` : `${words}s`);

// (лидирующая пунктуация)($)(целое: 1,234 или 1234)(.дробь)(% или s)(-year-old)(хвостовая пунктуация)
const NUMBER = /^([^\w$]*)(\$)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(%|s)?(-[A-Za-z][A-Za-z-]*)?([^\w]*)$/;

function speakToken(token: string): string {
  const m = NUMBER.exec(token);
  if (!m) return token;
  const [, lead, dollar, int, frac, suffix, tail = "", trail] = m;
  const plain = !int!.includes(",") && frac === undefined && !dollar && suffix !== "%";
  const n = Number(int!.replaceAll(",", ""));
  let words = plain && int!.length === 4 && n >= 1100 && n < 2100 ? year(n) : cardinal(int!.replaceAll(",", ""));
  if (frac !== undefined) words += ` point ${frac.split("").map((d) => ONES[Number(d)]).join(" ")}`;
  if (suffix === "s") words = plural(words);
  if (suffix === "%") words += " percent";
  if (dollar) words += n === 1 && frac === undefined ? " dollar" : " dollars";
  return `${lead}${words}${tail}${trail}`;
}

export function speakNumbers(text: string): string {
  // "$8.7 billion" → "8.7 billion dollars": валюта после масштаба, иначе вышло бы "dollars billion".
  const scaled = text.replace(/\$([\d.,]+)\s+(thousand|million|billion|trillion)\b/gi, "$1 $2 dollars");
  return scaled.replace(/\S+/g, speakToken);
}
