/**
 * Точка входа для браузера (веб-плеер): только компоненты, без @remotion/bundler
 * и @remotion/renderer — они тянут node:-модули и не собираются в клиентский бандл.
 */
export { ShortsVideo } from "./ShortsVideo.js";
export { SceneVisual } from "./scenes/index.js";
export { useTheme, useThemeFont, useFormat } from "./theme.js";
export { CaptionSample, CAPTION_SAMPLE } from "./CaptionSample.js";
