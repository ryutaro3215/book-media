// @ts-check
import { defineConfig } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";
import { SITE } from "./src/config.ts";

// https://astro.build/config
export default defineConfig({
  // OGPの絶対URL・canonical・sitemap の基準。値は src/config.ts の1箇所で管理する
  site: SITE.url,
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
