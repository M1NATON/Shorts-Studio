import { expect, test } from "@playwright/test";

/**
 * Полный сценарий из Plan.md §0: тема → сценарий → правка одной сцены (руками,
 * ИИ-варианты, текст) → стиль субтитров → экспорт MP4 → скачивание.
 */
test("тема → правка сцены → готовый MP4", async ({ page, request }) => {
  const topic = `E2E batteries ${Date.now()}`;

  // 1. Библиотека: создание ролика, генерация в очереди, карточка с обложкой.
  await page.goto("/");
  await page.getByPlaceholder(/Тема ролика/).fill(topic);
  await page.getByRole("button", { name: "Создать ролик" }).click();
  const card = page.locator(".tile", { hasText: `Video: ${topic}` });
  await expect(card.getByText("Черновик", { exact: true })).toBeVisible({ timeout: 180_000 });
  await expect(card.locator("img")).toBeVisible();

  // 2. Редактор: сцены, плеер, источник таймингов.
  await card.getByRole("link").last().click();
  const clips = page.getByRole("button", { name: /^Сцена \d+:/ });
  await expect(clips).toHaveCount(5);
  await expect(page.locator(".player-wrap")).toBeVisible();

  // 3. Ручная правка кадра сцены 3: мгновенно, новая версия в истории.
  await clips.nth(2).click();
  const heading = page.locator(".block-card").nth(1).locator("input.input").first();
  await heading.fill("Scale made packs cheap");
  await page.getByRole("button", { name: "Сохранить кадр" }).click();
  await page.getByRole("tab", { name: /История/ }).click();
  await expect(page.locator(".version").first()).toContainText("вручную");

  // Переполненный кадр ловится до сохранения, той же схемой, что ответ модели.
  await page.getByRole("tab", { name: "Кадр" }).click();
  await page.locator(".block-card").nth(1).locator("input.input").first().fill("A heading far too long for any frame ".repeat(4));
  await expect(page.locator(".issues")).toContainText("<=90 characters");
  await expect(page.getByRole("button", { name: "Сохранить кадр" })).toBeDisabled();
  await page.getByRole("button", { name: "Сбросить" }).click();

  // 4. ИИ: варианты кадра, выбор одного.
  await page.getByRole("tab", { name: "ИИ" }).click();
  await page.getByPlaceholder(/сделай столбцами/).fill("меньше текста");
  await page.getByRole("button", { name: "Пересобрать кадр" }).click();
  await expect(page.locator(".variant")).toHaveCount(2, { timeout: 120_000 });
  await page.locator(".variant").first().click();
  await expect(page.locator(".variant")).toHaveCount(0);

  // 5. Новый текст сцены — переозвучка только её.
  await page.getByRole("tab", { name: "Текст" }).click();
  await page.getByLabel("Текст озвучки").fill("Scale, chemistry and competition cut the price.");
  await page.getByRole("button", { name: "Сохранить и озвучить" }).click();
  await expect(page.getByRole("button", { name: /^Сцена 3: Scale, chemistry and competition/ })).toBeVisible({ timeout: 60_000 });

  // 6. Стиль субтитров.
  await page.getByRole("button", { name: /Субтитры/ }).click();
  await page.getByRole("radio", { name: "с обводкой" }).click();
  await expect(page.getByRole("button", { name: "Субтитры: с обводкой" })).toBeVisible();

  // 7. Экспорт MP4 и скачивание.
  await page.getByRole("button", { name: /Экспорт MP4/ }).click();
  await expect(page.locator(".jobs-bar")).toContainText(/Рендер|В очереди|…/, { timeout: 30_000 });
  const download = page.getByRole("link", { name: /Скачать/ });
  await expect(download).toBeVisible({ timeout: 240_000 });
  const href = await download.getAttribute("href");
  const video = await request.get(href!);
  expect(video.status()).toBe(200);
  expect(video.headers()["content-type"]).toBe("video/mp4");
  expect((await video.body()).length).toBeGreaterThan(20_000);
  await expect(page.locator(".topbar .status")).toHaveText("готов");
});

test("настройки: ключи не приходят в браузер, у кнопок есть имена", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Провайдеры" })).toBeVisible();
  // Поиск: у него единственное поле — ключ.
  const search = page.locator("section", { hasText: "Firecrawl" });
  await search.getByLabel("API key").fill("sk-e2e-secret-value-123456");
  await search.getByRole("button", { name: "Сохранить" }).click();
  await expect(search.getByText("Сохранено")).toBeVisible();
  // Модели без обязательных полей — понятная ошибка, а не молчание.
  const llm = page.locator("section", { hasText: "Модель — сценарий" });
  await llm.getByRole("button", { name: "Сохранить" }).click();
  await expect(llm.getByRole("status")).toContainText(/baseUrl|apiKey|model/);

  await page.reload();
  expect(await page.content()).not.toContain("sk-e2e-secret-value-123456");
  await expect(page.locator("section", { hasText: "Firecrawl" }).getByLabel("API key")).toHaveAttribute("placeholder", /••••3456/);

  // Доступность с клавиатуры: у каждой кнопки есть имя.
  for (const button of await page.getByRole("button").all()) {
    expect((await button.getAttribute("aria-label")) ?? (await button.innerText())).not.toBe("");
  }
});
