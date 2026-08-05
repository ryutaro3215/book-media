// @ts-check

import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { SITE } from "./src/config.ts";

// https://astro.build/config
export default defineConfig({
  // OGPの絶対URL・canonical・sitemap の基準。値は src/config.ts の1箇所で管理する
  site: SITE.url,
  integrations: [
    sitemap({
      // 検索結果ページは noindex にしているので sitemap からも外す
      filter: (page) => !page.includes("/search"),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
