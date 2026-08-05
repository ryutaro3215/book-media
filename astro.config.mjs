// @ts-check

import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";
import { adminDevServer } from "./scripts/lib/admin-dev-server.mjs";
import { SITE } from "./src/config.ts";

// https://astro.build/config
export default defineConfig({
  // OGPの絶対URL・canonical・sitemap の基準。値は src/config.ts の1箇所で管理する
  site: SITE.url,
  integrations: [
    sitemap({
      // 検索結果ページは noindex にしているので sitemap からも外す。
      // /admin と /api はローカル専用で、ビルド後に scripts/strip-admin.mjs が
      // dist から消す。sitemap はそれより先に作られるため、ここでも外さないと
      // **消したはずのURLを sitemap が申告し続ける**（Search Console に404が出る）
      filter: (page) => !/\/(search|admin|api)\b/.test(page),
    }),
  ],
  vite: {
    // adminDevServer は apply: "serve" なので、開発サーバーにしか生えない。
    // 記事ファイルを書く口を持つため、ビルドに混ざらないことが構造で保証される
    plugins: [tailwindcss(), adminDevServer()],
  },
});
