import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { downloadMedia, searchPexels } from "./pexels.js";

const options = { apiKey: "k", query: "lithium mine aerial" };

describe("searchPexels", () => {
  it("фото: query/orientation/page в запросе, portrait берёт src.portrait, иначе large2x", async () => {
    let requestedUrl = "";
    const fetchImpl = (async (url: string) => {
      requestedUrl = url;
      return new Response(
        JSON.stringify({
          photos: [
            {
              id: 1,
              width: 1080,
              height: 1920,
              photographer: "Jane Doe",
              photographer_url: "https://www.pexels.com/@jane",
              src: { large2x: "https://images.pexels.com/photos/1/large2x.jpg", portrait: "https://images.pexels.com/photos/1/portrait.jpg" },
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const portrait = await searchPexels({ ...options, kind: "photo", orientation: "portrait", fetchImpl, page: 2 });
    expect(portrait).toEqual([
      { pexelsId: 1, url: "https://images.pexels.com/photos/1/portrait.jpg", width: 1080, height: 1920, credit: { name: "Jane Doe", url: "https://www.pexels.com/@jane" } },
    ]);
    expect(requestedUrl).toContain("query=lithium+mine+aerial");
    expect(requestedUrl).toContain("orientation=portrait");
    expect(requestedUrl).toContain("page=2");

    const landscape = await searchPexels({ ...options, kind: "photo", orientation: "landscape", fetchImpl });
    expect(landscape[0]!.url).toBe("https://images.pexels.com/photos/1/large2x.jpg");
  });

  it("видео: mp4 не мельче 720 и не крупнее 1920, ближайший к цели по ориентации", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          videos: [
            {
              id: 7,
              duration: 12,
              user: { name: "Studio", url: "https://www.pexels.com/@studio" },
              video_files: [
                { file_type: "video/mp4", width: 640, height: 360, link: "https://videos.pexels.com/video-files/7/640.mp4" },
                { file_type: "video/mp4", width: 1280, height: 720, link: "https://videos.pexels.com/video-files/7/1280.mp4" },
                { file_type: "video/mp4", width: 1920, height: 1080, link: "https://videos.pexels.com/video-files/7/1920.mp4" },
                { file_type: "video/mp4", width: 3840, height: 2160, link: "https://videos.pexels.com/video-files/7/3840.mp4" },
                { file_type: "video/quicktime", width: 1920, height: 1080, link: "https://videos.pexels.com/video-files/7/mov.mov" },
              ],
            },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const landscape = await searchPexels({ ...options, kind: "video", orientation: "landscape", fetchImpl });
    expect(landscape).toEqual([
      { pexelsId: 7, url: "https://videos.pexels.com/video-files/7/1920.mp4", width: 1920, height: 1080, durationSec: 12, credit: { name: "Studio", url: "https://www.pexels.com/@studio" } },
    ]);

    const portrait = await searchPexels({ ...options, kind: "video", orientation: "portrait", fetchImpl });
    expect(portrait[0]!.url).toBe("https://videos.pexels.com/video-files/7/1280.mp4");
  });

  it("HTTP-ошибка с кодом", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    await expect(searchPexels({ ...options, kind: "photo", orientation: "portrait", fetchImpl })).rejects.toThrow("Pexels HTTP 401");
  });
});

describe("downloadMedia", () => {
  it("скачивает файл во временный путь и переименовывает", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "media-"));
    const dest = path.join(dir, "scene-123.jpg");
    let init: RequestInit | undefined;
    const fetchImpl = (async (_url: string, i?: RequestInit) => {
      init = i;
      return new Response("jpeg-bytes", { status: 200, headers: { "content-type": "image/jpeg" } });
    }) as unknown as typeof fetch;
    await downloadMedia({ url: "https://images.pexels.com/photos/1/large2x.jpg", dest, fetchImpl });
    expect(init?.redirect).toBe("error"); // редирект не обойдёт проверку хоста
    expect(readFileSync(dest, "utf8")).toBe("jpeg-bytes");
    expect(existsSync(`${dest}.part`)).toBe(false);
  });

  it("чужой хост — отказ до сети", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "media-"));
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("x", { status: 200 });
    }) as unknown as typeof fetch;
    await expect(downloadMedia({ url: "https://evil.example/photo.jpg", dest: path.join(dir, "x.jpg"), fetchImpl })).rejects.toThrow(/refused/);
    expect(called).toBe(false);
  });

  it("http (не https) — отказ", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "media-"));
    const fetchImpl = (async () => new Response("x", { status: 200 })) as unknown as typeof fetch;
    await expect(downloadMedia({ url: "http://images.pexels.com/photo.jpg", dest: path.join(dir, "x.jpg"), fetchImpl })).rejects.toThrow(/refused/);
  });

  it("неожиданный content-type — отказ", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "media-"));
    const fetchImpl = (async () => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    await expect(downloadMedia({ url: "https://images.pexels.com/photo.jpg", dest: path.join(dir, "x.jpg"), fetchImpl })).rejects.toThrow(/content-type/);
  });

  it("обрыв по maxBytes: ошибка, частичный файл удалён", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "media-"));
    const dest = path.join(dir, "big.mp4");
    const fetchImpl = (async () => new Response("x".repeat(1000), { status: 200, headers: { "content-type": "video/mp4" } })) as unknown as typeof fetch;
    await expect(downloadMedia({ url: "https://videos.pexels.com/video-files/1/big.mp4", dest, fetchImpl, maxBytes: 10 })).rejects.toThrow(/exceeds/);
    expect(existsSync(dest)).toBe(false);
    expect(existsSync(`${dest}.part`)).toBe(false);
  });
});
