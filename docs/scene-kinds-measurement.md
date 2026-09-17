# Замер: какие типы сцен LLM выбирает на самом деле

Фаза 1a. Цель — выбрать набор типов сцен MVP по факту, а не по догадке.
Инструмент: `scripts/measure-kinds.mjs` (одноразовый, не часть продукта).

## Условия

- Модель: `postman/GPT_56_SOL` через локальный OpenAI-совместимый прокси.
- Промпт даёт LLM **все 11 типов** из Plan.md §1 и правило «не уверен в цифрах — бери текстовый тип».
- 10 информационных тем, 6–9 сцен на ролик, `response_format: json_schema` (strict поддержан).

## Прогон 1 — без квот на разнообразие (73 сцены, 10 тем)

| kind | count | share |
|---|---|---|
| icon-list | 19 | 26% |
| quote-callout | 14 | 19% |
| kinetic-text | 11 | 15% |
| hook-statement | 10 | 14% |
| outro-cta | 10 | 14% |
| comparison | 5 | 7% |
| stat-counter | 3 | 4% |
| map-highlight | 1 | 1% |
| **bar-chart** | **0** | **0%** |
| **line-chart** | **0** | **0%** |
| **timeline** | **0** | **0%** |

## Прогон 2 — с квотами на визуальное разнообразие (52 сцены, 7 тем)

Добавлены правила: не более 2 текстовых сцен подряд; минимум один `stat-counter`
на реальной общеизвестной цифре; текстовый fallback только если числа реально нет.

| kind | прогон 1 | прогон 2 |
|---|---|---|
| stat-counter | 4% | **12%** |
| comparison | 7% | 13% |
| icon-list | 26% | 21% |
| текстовые (hook + quote + kinetic) | 48% | 39% |
| bar-chart / line-chart / timeline / map-highlight | 0% | 0% |

## Выводы, принятые в архитектуру

1. **`bar-chart`, `line-chart`, `timeline` исключены из MVP** — 0 из 125 сцен при том,
   что они были явно доступны. Заменены на `icon-list` (лидер в обоих прогонах).
2. **`quote-callout` и `kinetic-text` не становятся отдельными типами**, а покрываются
   полем `variant: "statement" | "quote"` у `hook-statement`: на них суммарно приходится
   треть ролика, но визуально это тот же крупный текст.
3. **Правила визуального разнообразия — обязательная часть system-промпта, а не пожелание.**
   Без них LLM скатывается в текст (48% сцен) и избегает цифр (stat-counter 4%).
   С ними доля stat-counter растёт втрое. Это самый дешёвый рычаг качества ролика.
4. **Ограничения провайдера**: одиночный запрос ~25 с; три параллельных дают HTTP 504.
   `llm-core`: конкурентность ≤ 2, таймаут ≥ 90 с, retry с backoff на 5xx.

## Как повторить

```bash
set -a; . ./.env; set +a
node scripts/measure-kinds.mjs                      # свободный выбор типов
BALANCED=1 node scripts/measure-kinds.mjs "Тема 1" "Тема 2"   # с квотами
```

## Прогон 3 — темы про ИИ (49 сцен, 7 из 10 тем; 3 упали по HTTP 504)

Темы: «Will AI actually rebel in 2026», «Why AI models hallucinate», «What one AI data
center really costs», «Why self-driving cars still need a human», «How much energy a single
AI query uses», «Why AGI keeps being five years away», «Why AI cannot be held legally
responsible», «Why AI still cannot replace junior engineers», «How AI changed the job of a
translator». Квоты на разнообразие включены.

| kind | count | share |
|---|---|---|
| icon-list | 13 | 27% |
| hook-statement | 7 | 14% |
| quote-callout | 7 | 14% |
| outro-cta | 7 | 14% |
| kinetic-text | 6 | 12% |
| comparison | 5 | 10% |
| stat-counter | 2 | 4% |
| timeline | 2 | 4% |
| bar-chart / line-chart / map-highlight | 0 | 0% |

### Что это меняет

1. **`icon-list` — лидер на всех трёх наборах тем** (26%, 21%, 27%). Решение заменить им
   `bar-chart` подтверждено трижды.
2. **`comparison` на AI-темах используется для понятий, а не для чисел**: «Level 4:
   restricted operating domain» против «Level 5: all roads and conditions», «narrow
   benchmark performance» против «adaptable general intelligence». Поэтому лимит
   `value` расширен с 24 до 36 символов, а `label` сокращён до 20 — с прежними границами
   реальные сцены не помещались.
3. **`stat-counter` на концептуальных темах проседает до 4% даже с квотами** — в отличие
   от нейтральных тем (12%). У тем про ИИ мало общеизвестных проверяемых чисел. Тип
   всё равно остаётся в MVP: найденные цифры сильные («median Gemini text prompt: 0.24 Wh»,
   подтверждается публикацией Google), и это единственный носитель числового акцента.
4. **Стабильность прокси**: 3 из 10 запросов упали с HTTP 504 при последовательном режиме,
   одиночный запрос ~25 с. Для `llm-core` это значит: `AbortSignal.timeout` обязателен
   (в первой версии скрипта его не было — запрос висел больше 10 минут), retry с backoff,
   конкурентность ≤ 2.
