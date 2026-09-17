# Shorts Studio — доработанный план реализации

> Версия 2. Базируется на исходном плане, сохраняет его архитектуру, дизайн-систему и фазы, но закрывает пробелы, из-за которых готовый продукт не соответствовал бы цели: **информативные, визуально интересные англоязычные ролики с точной синхронизацией озвучки, субтитров и анимации, генерируемые end-to-end из одного приложения**.

## 0. Что должно получиться в итоге (contract с пользователем)

Пользователь открывает одно приложение (`pnpm run studio`, один URL) и:

1. Выбирает тип ролика (сейчас — Shorts 9:16; архитектура не закрывает дверь для 16:9 в будущем, но в MVP только Shorts).
2. Вводит тему/название ролика (и, опционально, тезисы/источник).
3. Нажимает "Сгенерировать сценарий" — LLM создаёт структурированный сценарий на английском: по сценам, с текстом озвучки и **визуальной спецификацией** каждой сцены (что именно показывать — график, счётчик, сравнение и т.д.), не просто текст.
4. Просматривает и правит сценарий по сценам (текст, визуальный тип, данные для графика).
5. Запускает подготовку (Preparation): для каждой сцены отдельно вызывается TTS (Fish Audio), получаются аудио + word-level timings; строится единый manifest с кадровой синхронизацией видео/озвучки/субтитров.
6. Смотрит preview в редакторе (Remotion Player) — ролик с анимированной графикой, синхронными субтитрами, войсовером.
7. Если сцена не устроила — перегенерирует **только её** (текст, визуал или озвучку по отдельности), остальные сцены и их аудио не трогаются, таймлайн после неё автоматически пересчитывается.
8. Настраивает провайдеров (LLM для сценария/визуала: имя, base URL, API key, модель; TTS: провайдер, API key, голос/модель) — сохраняются персистентно, ключи никогда не уходят в браузер.
9. Экспортирует готовый MP4 через Remotion render, без открытия Remotion Studio.

Это и есть definition of done. Всё остальное в плане — как этого добиться.

## 1. Ключевое архитектурное решение: как ИИ вообще генерирует "видео", а не просто текст поверх фона

Это главный пробел исходного плана — там было "Remotion для рендера" и "установить скиллы для Remotion", но не было решения **как именно контент превращается в анимацию**. Есть два подхода, и от выбора зависит всё остальное.

### Вариант A — LLM пишет "сырой" Remotion/React-код на каждую сцену

LLM генерирует TSX-компонент сцены напрямую.

- Плюсы: максимальная гибкость, буквально любая анимация.
- Минусы: непредсказуемо (компиляция может падать), небезопасно (произвольный код в рендер-процессе), медленно (нужен build/сборка на каждую генерацию), тяжело гарантировать "информативность" и синхронизацию с audio timings — LLM должен сам считать кадры, а он это делает ненадёжно. Для продакшн-инструмента с UI/UX ожиданиями это неприемлемый риск.

### Вариант B — Декларативные шаблоны сцен ("Scene Visual Spec" + библиотека Remotion-компонентов)

LLM не пишет код, а заполняет **типизированный JSON** по одному из заранее реализованных и провизуально проверенных типов сцен. Remotion-композиции уже написаны людьми (или один раз сгенерированы и закреплены как код), кадровая синхронизация встроена в сами компоненты через `useCurrentFrame()` и manifest.

Библиотека типов сцен (MVP-набор, покрывает 90% информационных Shorts):

| Тип сцены | Что показывает | Ключевые поля данных |
|---|---|---|
| `hook-statement` | Крупный кинетический текст-заголовок (хук) | `text`, `emphasisWords[]` |
| `stat-counter` | Анимированный счётчик числа/процента | `label`, `fromValue`, `toValue`, `unit`, `icon` |
| `bar-chart` | Столбчатая диаграмма сравнения | `categories[]`, `values[]`, `unit` |
| `line-chart` | Динамика во времени | `points[{x,y}]`, `xLabel`, `yLabel` |
| `comparison` | Два/три варианта бок о бок ("до/после", "А vs Б") | `items[{label, value, icon}]` |
| `timeline` | Хронология событий | `events[{date, text}]` |
| `icon-list` | Список тезисов с иконками, поочерёдное появление | `items[{icon, text}]` |
| `map-highlight` | Подсветка региона/страны на схематичной карте | `region`, `label` |
| `quote-callout` | Цитата/важный тезис крупным планом | `text`, `attribution?` |
| `kinetic-text` | Динамичный текст без данных (переход, вывод) | `text`, `style` |
| `outro-cta` | Финальный экран с призывом к действию | `text`, `subtext?` |

Каждый тип — отдельный Remotion-компонент с уже продуманной анимацией появления, таймингом относительно длительности сцены и лимитами (макс. длина текста, макс. число элементов в списке/графике), которые LLM обязан соблюдать (валидируется Zod-схемой на этапе генерации сценария — если LLM превысил лимит, идёт retry с укороченным промптом).

**Решение: вариант B — основной путь.** Для гибкости добавляется один "escape hatch" тип `custom-composition` — тоже декларативный (ограниченный набор примитивов: текстовый блок, иконка, форма, изображение, их позиция/анимация из fixed enum), а не произвольный код, чтобы сохранить безопасность и предсказуемость. `custom-composition` — это то, что в исходном плане имелось в виду под "скиллы для Remotion": не обучение модели писать TSX, а исчерпывающая документация/system-prompt с описанием, какие типы сцен и примитивы существуют, их поля и ограничения, чтобы LLM на этапе генерации сценария всегда выбирал подходящий тип и корректно заполнял данные.

`packages/remotion` в целевой архитектуре получает новый подпакет `packages/remotion/scenes/*` — по одному файлу на тип сцены, плюс `packages/contracts/scene-visual-spec.ts` с Zod-схемами всех типов (discriminated union по полю `kind`).

## 2. Сквозной пайплайн генерации (Script → Manifest → Preview → Render)

Дополняет существующие фазы контрактов и media-core явным описанием того, что раньше подразумевалось, но не было расписано.

1. **Script Generation** (новый модуль `ScriptService` в API, использует LLM provider settings):
   - Вход: тема, тезисы (опц.), целевая длительность/число сцен.
   - System-промпт фиксирует: язык — английский, стиль — информативный и увлекательный (хук в первой сцене, конкретные факты/цифры, чёткий вывод в конце), обязательное соответствие `ScriptSchema` (Zod), для каждой сцены — `narration` (текст озвучки) и `visual: SceneVisualSpec`.
   - Ответ LLM валидируется; при ошибке схемы — до 2 автоматических retry с указанием, что именно не так (не показываем пользователю "сырую" ошибку валидации).
   - Результат — `Script` сохраняется в проекте, доступен для ручного редактирования по сценам.

2. **Per-scene TTS generation** (уточняет Фазу 2 media-core):
   - Fish Audio (и любой другой TTS) имеет лимит символов на один запрос → `narration` каждой сцены отправляется **отдельным запросом**, это уже заложено правильно в требовании пользователя, план явно это фиксирует как контракт `TtsProvider.synthesizeScene(sceneId, text) → { audioFile, wordTimings[] }`.
   - Если текст одной сцены сам превышает лимит символов провайдера (редкий, но возможный случай) — narration сцены разбивается на несколько TTS-запросов **внутри одной сцены**, аудио склеивается (concat по семплам, не по файлу-контейнеру, чтобы не было щелчков), word timings сцены — это конкатенация timings по чанкам со сдвигом на длительность предыдущих чанков. Наружу (в manifest) сцена всегда выглядит как один непрерывный `audioFile` + один `wordTimings[]`.
   - Лимит символов — параметр конфигурации провайдера (`maxCharsPerRequest`), не захардкожен, т.к. отличается между Fish Audio/OpenAI/другими.

3. **Alignment (синхронизация субтитров)**:
   - Основной путь: если TTS-провайдер возвращает word-level timestamps (Fish Audio в некоторых режимах — да, не всегда для всех голосов/языков) — используем их напрямую, `source: "native"`.
   - Fallback: если провайдер timestamps не вернул — прогоняем forced alignment (например, whisper-based aligner) локально на API/worker стороне по готовому аудио и тексту сцены, `source: "aligned"`.
   - Крайний fallback: равномерное распределение по длине слов, `source: "estimated"` — помечается в manifest и **в UI показывается предупреждение**, что синхронизация приблизительная (это уже было в исходном плане, сохраняем).
   - `source` каждой сцены хранится в manifest и никогда не выдаётся молча за точный тайминг — критично для качества финального ролика.

4. **Manifest build**: объединяет `Script` (visual specs) + результаты TTS/alignment по каждой сцене → единый immutable `ProjectManifest` (как в исходном плане: `startFrame` — источник истины, `startSec` производный).

5. **Preview**: `@remotion/player` рендерит те же `packages/remotion/scenes/*` компоненты на том же manifest, что и финальный export — гарантия "preview = экспорт", это уже было заявлено в исходном плане, здесь просто подтверждается, что тип сцены из visual spec — это прямой `switch` на компонент без дополнительной трансформации.

6. **Export**: Remotion render с тем же manifest snapshot, headless, в worker-процессе.

## 3. Providers & Settings (LLM и TTS раздельно)

Исходный план упоминал только TTS settings. Добавляем LLM provider settings как равноценный раздел — без него не работает п.1 (Script Generation).

`packages/contracts/settings.ts`:

```text
LlmProviderConfig:
  id, label
  baseUrl        // разный у OpenAI-совместимых, Anthropic, локальных LLM и т.д.
  apiKey         // хранится только на API-стороне, masked в ответах наружу
  model
  isDefault

TtsProviderConfig:
  id, label            // например "Fish Audio"
  baseUrl?
  apiKey
  voiceId / model
  maxCharsPerRequest   // используется для чанкинга (см. п.2.2)
  supportsWordTimings: boolean
  isDefault
```

- `GET/PUT /api/settings/llm` и `GET/PUT /api/settings/tts` — список провайдеров, CRUD, "Test connection" (делает лёгкий тестовый запрос и возвращает ok/ошибку, не тратя лимиты по-крупному).
- В UI: экран Settings с двумя вкладками (LLM, TTS), формы с masked API key (показывается `••••1234`), выбор дефолтного провайдера на проект.
- В `ScriptService` и `TtsService` провайдер выбирается либо дефолтный, либо явно указанный в проекте — так поддерживаются разные модели/провайдеры для разных проектов без пересборки.
- Жёсткое правило из исходного плана сохраняется и усиливается: API keys не в browser bundle, не в manifest, не в логах, не в telegram/error трейсах — добавляем явный unit-test "grep по бандлу/манифесту/логам на отсутствие секретов" в CI.

## 4. Перегенерация сцены — три независимых уровня

Исходный план упоминал "возможность перегенерировать сцену" одной строкой. Расписываем, потому что "перегенерировать" у видео с озвучкой и визуалом — неоднозначно; нужно три отдельных действия, а не одна кнопка:

1. **Regenerate script (text + visual spec)** — LLM переписывает `narration` и/или `visual` этой сцены (с учётом контекста соседних сцен, чтобы не терялась связность); TTS для этой сцены помечается stale, требуется повторная подготовка аудио.
2. **Regenerate voiceover only** — тот же текст, новый TTS-запрос (например, не понравилась интонация/голос) — не трогает текст и visual spec.
3. **Regenerate visual only** — тот же текст и аудио, новый visual spec (например, LLM предлагает другой тип графика для тех же данных) или ручное редактирование данных графика пользователем без обращения к LLM вообще.

Механика пересчёта: каждая сцена хранит `contentHash` (script) и `audioHash` (narration text + tts params). Изменение одной сцены:
- не трогает аудио/рендер других сцен (кэш по hash, как и было заявлено в исходном плане);
- пересчитывает только `startFrame` сцен **после** изменённой (т.к. её длительность могла измениться) — реализуется как чистая функция `recomputeTimeline(scenes)` в `TimelineBuilder`, вызывается после любого изменения аудио-длительности любой сцены;
- preview обновляется точечно (React re-render только изменённой сцены + сдвиг таймлайна), полный re-render Remotion не требуется для preview (только для финального export).

UI: в Scene inspector — три отдельные кнопки/действия ("Переписать текст и визуал", "Переозвучить", "Изменить визуал"), а не одна общая "Regenerate".

## 5. Гарантии "информативности и интересности" контента — не только техника

Это требование пользователя нельзя закрыть только архитектурой рендера — часть ответственности на промпт-инжиниринге:

- System-промпт `ScriptService` фиксирует структуру хорошего Shorts-сценария: hook в сцене 1 (вопрос/шокирующий факт/цифра), 1 факт/идея на сцену (не перегружать), конкретные цифры вместо общих фраз, явный вывод/CTA в последней сцене.
- Для каждого типа сцены с данными (`stat-counter`, `bar-chart`, `line-chart`, `comparison`, `timeline`) промпт требует **реальные конкретные данные**, а не "example data" — если тема требует проверяемых фактов, а LLM не уверен в цифрах, он обязан выбрать `kind: "kinetic-text"` или `"quote-callout"` вместо графика с выдуманными числами (защита от фейковой статистики на экране).
- Длина `narration` на сцену ограничена сверху (в секундах речи при среднем темпе ~2.5 слова/сек) — чтобы озвучка не растягивала сцену дольше, чем анимация визуала рассчитана держать интерес; лимит — параметр конфигурации типа ролика (Shorts ⇒ обычно 3–6 сек на сцену, 6–9 сцен на ролик).
- Каждый Remotion-компонент сцены обязан иметь entrance-анимацию (не статичный кадр с первого frame) — это фиксируется как acceptance-критерий Фазы 5 (расширенной), а не только пожелание дизайна.

## 6. Обновлённая целевая архитектура

```text
apps/
  web/               Next.js App Router + React + Tailwind — редактор
  api/                NestJS + Fastify — projects, script generation, TTS, jobs, settings
packages/
  contracts/          Zod-схемы: Script, SceneVisualSpec (discriminated union), Manifest,
                       Project, Job, SubtitleStyle, LlmProviderConfig, TtsProviderConfig
  media-core/         TTS provider interface + Fish/OpenAI adapters, chunking, cache,
                       alignment (native/aligned/estimated), TimelineBuilder, captions
  llm-core/           LLM provider interface (OpenAI-совместимый + произвольный baseUrl),
                       ScriptService prompts, response validation + retry
  remotion/           scenes/* (один компонент на тип из SceneVisualSpec), preview player,
                       export renderer, captions overlay
  db/                 Drizzle schema and repositories
storage/               audio, renders, thumbnails, projects
```

`llm-core` — новый пакет относительно исходного плана, выделен по аналогии с `media-core`, чтобы `ScriptService` не знал о Next/Nest и был тестируем изолированно (mock LLM responses в unit-тестах).

## 7. Целевая модель API (дополнено)

```text
GET/POST/PATCH/DELETE /api/projects
POST /api/projects/:id/script                 // сгенерировать сценарий целиком (LLM)
PATCH /api/projects/:id/script/scenes/:sceneId // ручная правка текста/визуала сцены
POST /api/projects/:id/script/scenes/:sceneId/regenerate-text
POST /api/projects/:id/script/scenes/:sceneId/regenerate-visual
POST /api/projects/:id/preparations             // TTS + alignment + manifest build
GET /api/preparations/:id
POST /api/preparations/:id/cancel
POST /api/preparations/:id/scenes/:sceneId/regenerate-voice   // точечная переозвучка
POST /api/preparations/:id/renders
GET /api/renders/:id
POST /api/renders/:id/cancel
GET /api/renders/:id/download
GET/PUT /api/settings/llm
GET/PUT /api/settings/tts
POST /api/settings/llm/:id/test-connection
POST /api/settings/tts/:id/test-connection
```

`Project` хранит исходный `Script` (по сценам, с visual spec) и настройки (выбранные провайдеры). `Preparation` хранит `sourceHash` (от Script) и immutable manifest snapshot. `RenderJob` всегда ссылается на конкретную `Preparation`. Точечные regenerate-эндпоинты инвалидируют только затронутую сцену и всё, что зависит от неё по таймлайну — остальной manifest переиспользуется.

## 8. Порядок этапов (обновлено)

1. **Фаза 0** — репозиторий, toolchain и тестовая основа.
2. **Фаза 1** — контракты данных и схемы валидации, включая `SceneVisualSpec` discriminated union.
3. **Фаза 2** — media-core: TTS interface (+ чанкинг по `maxCharsPerRequest`, конкатенация чанков), cache, timeline, alignment (native/aligned/estimated), captions, manifest.
4. **Фаза 2.5 — llm-core**: LLM provider interface, ScriptService, промпты, Zod-валидация ответа + retry-цикл, unit-тесты на mock-провайдере. *(новая фаза относительно исходного плана — без неё Фаза 4 не сможет предложить пользователю генерацию сценария)*
5. **Фаза 3** — API, SQLite/Drizzle, persistent jobs и storage, settings modules (LLM + TTS).
6. **Фаза 4** — Next.js editor и пользовательский workflow, включая экран Script (генерация + постатейное редактирование) и три отдельные кнопки regenerate.
7. **Фаза 5** — Remotion: библиотека `scenes/*` компонентов (11 типов из п.1) + `custom-composition`, preview, render и export.
8. **Фаза 6** — интеграция, единый запуск и удаление временных заглушек.
9. **Фаза 7** — полная приёмка и release gate.

Остальные правила реализации с нуля, границы данных (`packages/contracts` не зависит от приложений, `media-core`/`llm-core`/Remotion не делают лишних сторонних вызовов друг у друга, API keys только на API/worker-стороне, один immutable manifest snapshot для preview и export) — без изменений, см. исходные разделы ниже.

## 9. Дизайн, UX, темы, макет редактора

Дизайн-система, цветовые токены (light/dark), типографика, макет `260px minmax(480px, 1fr) 320px`, принципы ("спокойный монтажный редактор, не AI-dashboard"), стили субтитров (`clean`, `karaoke`, `boxed`, `outline`), motion-гайдлайны — переносятся из исходного плана **без изменений**, они не противоречат новой архитектуре генерации контента. Единственное дополнение:

- В Scene inspector вкладка **Visual** теперь показывает не абстрактные настройки, а форму, соответствующую конкретному `kind` сцены (для `bar-chart` — редактор категорий/значений, для `stat-counter` — from/to/unit и т.д.), плюс селектор смены `kind` (что и есть "Regenerate visual only" в ручном режиме, без LLM).
- Bottom status для стадии Preparation показывает прогресс **по сценам** (например "Озвучка: сцена 4 из 9"), т.к. TTS теперь всегда идёт по сценам отдельными запросами — это должно быть видно пользователю, а не скрыто за одним общим progress bar.

## 10. Итоговые критерии готовности (обновлено)

- Один URL запускает весь пользовательский workflow: тема → сценарий → правки → preview → export.
- Сценарий генерируется на английском, по типизированной visual-схеме на сцену, проходит валидацию перед сохранением.
- TTS вызывается по сценам отдельными запросами; сцены, превышающие лимит символов провайдера, чанкуются и склеиваются прозрачно для остальной системы.
- Субтитры и озвучка синхронизированы на уровне слов; источник тайминга (native/aligned/estimated) виден в UI, "estimated" никогда не выдаётся молча за точный.
- Каждый тип визуальной сцены анимирован (entrance-анимация обязательна), не статичный текст на фоне.
- Перегенерация сцены доступна тремя независимыми действиями (текст+визуал / только озвучка / только визуал), не трогает остальные сцены и корректно сдвигает таймлайн.
- Providers (LLM и TTS) настраиваются раздельно, с произвольным `baseUrl` у LLM, ключи маскируются в UI и никогда не покидают API/worker-сторону (закрыто тестом в CI).
- Projects/jobs переживают перезапуск; повторная подготовка/рендер с тем же hash не тратит API повторно.
- Preview (`@remotion/player`) и финальный MP4 рендерятся из одного immutable manifest и визуально идентичны.
- UI доступен с клавиатуры, работает в light/dark, соответствует WCAG AA.
- `pnpm typecheck`, unit, API, E2E (включая полный сценарий "тема → готовый MP4"), visual checkpoints и accessibility checks — зелёные.

---

## Приложение: исходные разделы плана (сохранены без содержательных изменений)

Ниже — детальные пункты по фазам, дизайн-токенам, компонентам и правилам, перенесённые из исходной версии плана как есть; они остаются в силе и дополняются, а не заменяются, разделами 1–10 выше.

### Правила реализации с нуля

- Все приложения, пакеты, контракты, хранилища и тесты создаются заново.
- Не переносить и не сохранять legacy-импорты, старые routes и compatibility mode.
- Каждая фаза начинается только после успешной проверки предыдущей.
- Сначала создаются контракты и тесты, затем реализация.
- Реальные TTS-провайдеры подключаются только после mock-пути Script → Manifest → Preview → Render.
- API keys доступны только API/worker стороне и никогда не попадают в browser bundle, manifest, logs или errors.
- Все jobs и проекты хранятся персистентно и переживают перезапуск.
- Preview и export используют один immutable manifest snapshot.
- Любая завершённая фаза должна иметь typecheck и соответствующие unit/integration/E2E-тесты.
- `pnpm run studio` запускает весь пользовательский workflow одним URL.

### Технологии

- pnpm workspaces + Turborepo — монорепозиторий и общий кеш сборки.
- Next.js App Router — UI и локальный web server.
- NestJS с Fastify adapter — модульный API, jobs, проекты, TTS, LLM, экспорт.
- TypeScript strict — общий язык всех пакетов.
- Tailwind CSS + CSS variables — дизайн без CSS в template literal.
- Radix UI primitives — доступные dialog, select, tooltip, tabs и dropdown.
- React Hook Form + Zod — формы и одинаковая валидация.
- TanStack Query — запросы, polling jobs и invalidation.
- SQLite + Drizzle — надёжное локальное хранение проектов и jobs.
- p-queue — локальная очередь без обязательного Redis; JobQueue сделать заменяемым на BullMQ.
- Remotion + `@remotion/player` — один источник для preview и MP4.
- Vitest/Node test + Playwright — unit, API и полный пользовательский сценарий.
- Pino — структурированные логи без секретов.

### Дизайн-токены тем

```text
light:
  canvas      #F5F3EF
  surface     #FFFEFA
  surface-2   #ECE9E3
  surface-3   #E4E0D8
  border      #D9D5CC
  text        #262724
  muted       #85847D
  accent      #B6533F
  accent-soft #F3E1DC
  success     #587B68
  danger      #A94442

dark:
  canvas      #171817
  surface     #222421
  surface-2   #2B2E2A
  surface-3   #353934
  border      #424740
  text        #EEECE6
  muted       #A2A49B
  accent      #DCA268
  accent-soft #44372B
  success     #91B59A
  danger      #E07A75
```

Accent используется для primary action, текущего playhead, выбранной сцены и активного слова. Не более одного главного акцента на тему; secondary hues разрешены только в preset preview и media content.

### Что не использовать в UI

- фиолетово-синие, розово-циановые и rainbow gradients;
- neon/glow и glassmorphism без функциональной причины;
- огромные hero-блоки, декоративные KPI и «магические» AI-метрики;
- emoji вместо иконок интерфейса;
- серые placeholder-карточки вместо реального media preview;
- разные радиусы, тени и иконки без токена;
- цвет как единственный способ показать состояние.

### Макет редактора

Desktop grid: `260px minmax(480px, 1fr) 320px`, минимальная ширина 1120 px для полного режима. При меньшей ширине: inspector превращается в drawer, scene list становится collapsible, preview остаётся приоритетным, timeline становится горизонтально прокручиваемой.

1. Top bar: project name, save state, theme, undo/redo, export.
2. Scene rail: reorder, duplicate, delete, add, duration и preparation state.
3. Preview canvas: 9:16, play/pause, seek, current scene, safe-zone overlay.
4. Inspector: Script, Visual, Subtitles, Audio tabs (Visual — новая вкладка, форма по типу сцены, см. раздел 9).
5. Bottom status: current job, progress по сценам, actionable error, download.

### Стили субтитров

Типизированные presets: `clean`, `karaoke`, `boxed`, `outline`. Каждый preset содержит `fontFamily`, `fontSize`, `fontWeight`, `textColor`, `activeColor`, `outline`, `background`, `maxWidth` и `position`. Preview и Remotion получают один `SubtitleStyleConfig`. Смена стиля не запускает TTS и alignment.

### Дизайн-прототипы и визуальная проверка

До реализации UI сохранять самостоятельные прототипы (`design-preview-v2.html` — светлая/тёмная темы; `design-preview-v3.html` — полноценный editor layout). Прототипы — только визуальная референсная площадка, не production implementation. Перед переносом в Next проверить desktop 1440 px, tablet 1024 px и mobile 390 px.
