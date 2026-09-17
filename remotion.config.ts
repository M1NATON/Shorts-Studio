import { Config } from "@remotion/cli/config";

/**
 * Конфиг читает только Remotion CLI (студия). Рендер идёт через bundle() из
 * @shorts/remotion и этот файл не использует.
 *
 * extensionAlias нужен, потому что пакеты собираются в режиме NodeNext: в исходниках
 * импорты указывают на "./Root.js", а на диске лежит "./Root.tsx". Рендер этого не
 * замечает, потому что бандлит уже скомпилированный dist.
 */
Config.overrideWebpackConfig((config) => ({
  ...config,
  resolve: {
    ...config.resolve,
    extensionAlias: {
      ".js": [".ts", ".tsx", ".js"],
    },
  },
}));

Config.setPublicDir("storage");
