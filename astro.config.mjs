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
    server: {
      watch: {
        /**
         * `/admin` が書き込むファイルを、監視から外す。
         *
         * `/admin` で ISBN の「取得」を押すと、書影URLが
         * `src/data/covers.json` に記録される。ところがこれは `src/` の中なので
         * Vite が変更を検知して**画面をリロードし、入力中の記事が全部消えていた。**
         * 2冊目で必ず起きる（1冊目は記録済みになるので2回目は起きない）という
         * 分かりにくい壊れ方をしていた。
         *
         * 記録を `.cache/` から `src/data/` へ移したとき（T28）の見落とし。
         * git 管理下に置く判断は変えたくないので、監視の方を外す。
         *
         * `public/covers/` も同じ。`/admin` から書影を置くとリロードが起きる。
         *
         * **失うもの:** エディタやFinderから `public/covers/` に画像を置いても
         * 自動では反映されなくなる。ブラウザを手で再読み込みすれば出る
         * （`findLocalCover` はメモ化の外にあるため、再描画されれば拾う）。
         */
        ignored: ["**/src/data/covers.json", "**/public/covers/**"],
      },
    },
  },
});
