/**
 * Одноразовый исследовательский замер (Фаза 1a): какие типы сцен LLM реально выбирает
 * на заданных темах, если ему доступны ВСЕ 11 типов из Plan.md.
 * Нужен, чтобы набор MVP выбирался по факту, а не по догадке. Не часть продукта.
 */
const BASE = process.env.LLM_BASE_URL;
const KEY = process.env.LLM_API_KEY;
const MODEL = process.env.LLM_MODEL;

const KINDS = [
  ["hook-statement", "big kinetic headline text, no data needed"],
  ["stat-counter", "one animated number/percentage (label, from, to, unit)"],
  ["bar-chart", "bar chart comparing 3-5 categories with real comparable numbers"],
  ["line-chart", "line chart of a value changing over time"],
  ["comparison", "two or three options side by side (A vs B, before/after)"],
  ["timeline", "chronology of dated events"],
  ["icon-list", "2-4 bullet points with icons, appearing one by one"],
  ["map-highlight", "a region/country highlighted on a schematic map"],
  ["quote-callout", "a quote or key statement in large type"],
  ["kinetic-text", "dynamic text without data (transition or conclusion)"],
  ["outro-cta", "final screen with a takeaway and call to action"],
];

const VARIETY = `

VISUAL VARIETY (mandatory):
- Never use more than 2 text-only scenes (hook-statement, quote-callout, kinetic-text) in a row.
- Every script must contain at least one stat-counter built on a real, widely documented figure.
  Almost every topic has one well-known number: a duration, a percentage, a count, a temperature, a cost.
  Recall the figure that is actually established for this topic and use it.
- Only fall back to a text-only scene when the fact genuinely has no number and no comparison.`;

const SYSTEM = `You are a scriptwriter for informative vertical short videos (9:16, ~35 seconds).
Write in English. Structure: scene 1 is a hook, middle scenes carry one fact each, last scene is a takeaway.

For every scene you MUST choose exactly one visual type from this library:
${KINDS.map(([k, d]) => `- ${k}: ${d}`).join("\n")}

Rules:
- Pick the type that genuinely fits the content of that scene. Do not default to one type.
- Types with data (stat-counter, bar-chart, line-chart, comparison, timeline, map-highlight) require REAL, specific, verifiable figures.
  If you are not confident about the actual numbers, you MUST pick a text-based type instead of inventing data.
- narration: one sentence, max 250 characters, spoken text only.
- visual_summary: the concrete data/text that would appear on screen.
${process.env.BALANCED ? VARIETY : ''}`;



const SCHEMA = {
  name: "short_script",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["scenes"],
    properties: {
      scenes: {
        type: "array",
        minItems: 6,
        maxItems: 9,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["kind", "narration", "visual_summary"],
          properties: {
            kind: { type: "string", enum: KINDS.map(([k]) => k) },
            narration: { type: "string" },
            visual_summary: { type: "string" },
          },
        },
      },
    },
  },
};

const TOPICS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "Why the deep ocean is still unexplored",
      "How sleep debt damages your brain",
      "Why chip factories cost billions",
      "The real cost of fast fashion",
      "How black holes actually form",
      "Why some countries have no rivers",
      "What caffeine does to your body",
      "Why old buildings survive earthquakes better",
      "How GPS satellites bend time",
      "Why honey never spoils",
    ];

async function gen(topic) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `Topic: ${topic}` },
      ],
      response_format: { type: "json_schema", json_schema: SCHEMA },
      temperature: 0.8,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return JSON.parse(body.choices[0].message.content).scenes;
}

const limit = Number(process.env.CONCURRENCY ?? 1);
const results = [];
const queue = [...TOPICS];
await Promise.all(
  Array.from({ length: limit }, async () => {
    while (queue.length) {
      const topic = queue.shift();
      try {
        const scenes = await gen(topic);
        results.push({ topic, scenes });
        process.stderr.write(`ok  ${topic} (${scenes.length})\n`);
      } catch (e) {
        process.stderr.write(`ERR ${topic}: ${e.message}\n`);
      }
    }
  }),
);

const hist = new Map(KINDS.map(([k]) => [k, 0]));
const positions = new Map();
for (const { scenes } of results) {
  scenes.forEach((s, i) => {
    hist.set(s.kind, (hist.get(s.kind) ?? 0) + 1);
    const pos = i === 0 ? "first" : i === scenes.length - 1 ? "last" : "middle";
    positions.set(s.kind, { ...(positions.get(s.kind) ?? {}), [pos]: ((positions.get(s.kind) ?? {})[pos] ?? 0) + 1 });
  });
}
const total = [...hist.values()].reduce((a, b) => a + b, 0);
console.log(`\nTopics: ${results.length}/${TOPICS.length}, scenes: ${total}\n`);
console.log("kind              count   share   position(first/middle/last)");
for (const [k, c] of [...hist.entries()].sort((a, b) => b[1] - a[1])) {
  const p = positions.get(k) ?? {};
  console.log(
    `${k.padEnd(17)} ${String(c).padStart(4)}  ${String(Math.round((c / total) * 100)).padStart(4)}%   ${p.first ?? 0}/${p.middle ?? 0}/${p.last ?? 0}`,
  );
}
console.log("\n--- sample data-bearing scenes (проверить, не выдуманы ли цифры) ---");
for (const { topic, scenes } of results.slice(0, 4))
  for (const s of scenes.filter((x) => ["stat-counter", "bar-chart", "line-chart", "comparison", "timeline"].includes(x.kind)).slice(0, 2))
    console.log(`[${s.kind}] ${topic}\n    ${s.visual_summary}`);
