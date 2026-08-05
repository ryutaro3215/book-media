/**
 * サイト共通のデフォルト OGP 画像（トップ・固定ページ用）。
 * SEO.astro の ogImage 既定値 `/og-default.png` に対応する。
 * 記事ページは /og/<slug>.png を使うため、ここは記事以外の共有カードになる。
 */
import type { APIRoute } from "astro";
import { SITE } from "../config";
import { renderOgImage } from "../lib/og-template";

export const prerender = true;

export const GET: APIRoute = async () => {
  // 記事用テンプレートを流用する。
  // 選者名の位置にサイト名を置き、「一言説明」を書名行の位置に出す。
  const png = await renderOgImage({
    selectorName: SITE.name,
    topic: "その道の人しか知らない本",
    bookTitles: [SITE.description],
    siteName: SITE.name,
  });

  return new Response(png as unknown as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
