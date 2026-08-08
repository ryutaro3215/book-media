/**
 * サイト共通のデフォルト OGP 画像（トップ・固定ページ用）。
 * SEO.astro の ogImage 既定値 `/og-default.png` に対応する。
 * 記事ページは /og/<slug>.png を使うため、ここは記事以外の共有カードになる。
 */
import type { APIRoute } from "astro";
import { SITE } from "../config";
import { getAllInterviews } from "../lib/collections";
import { renderSiteOgImage } from "../lib/og-template";

export const prerender = true;

export const GET: APIRoute = async () => {
  // 公開中の分野を足元に出す。**共有された時点の中身を映す**ので、
  // 記事が増えれば自動で厚くなる。手で書くと必ず古くなる
  const articles = await getAllInterviews();
  const topics = [...new Set(articles.map((a) => a.data.topic))];

  const png = await renderSiteOgImage({
    siteName: SITE.name,
    tagline: "その領域に詳しい人が、\nその領域を学ぶための数冊を選ぶ。",
    footnote:
      topics.length > 0
        ? `${topics.join("・")}　全${articles.length}本`
        : undefined,
  });

  return new Response(png as unknown as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
