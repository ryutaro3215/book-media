/**
 * 記事ごとの OGP 画像を **ビルド時に** 静的生成するエンドポイント。
 * 出力先は dist/og/<slug>.png。ランタイム生成はしない（prerender 前提）。
 */

import type { APIRoute, GetStaticPaths } from "astro";
import { SITE } from "../../config";
import { getAllInterviews, selectorOf } from "../../lib/collections";
import { renderOgImage } from "../../lib/og-template";

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  // 下書きのOGP画像は生成しない
  const interviews = await getAllInterviews();
  return interviews.map((entry) => ({
    params: { slug: entry.data.slug },
    props: {
      selectorName: selectorOf(entry).name,
      topic: entry.data.topic,
      bookTitles: entry.data.books.map((b) => b.title),
    },
  }));
};

export const GET: APIRoute = async ({ props }) => {
  const png = await renderOgImage({
    selectorName: props.selectorName as string,
    topic: props.topic as string,
    bookTitles: props.bookTitles as string[],
    siteName: SITE.name,
  });

  return new Response(png as unknown as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
