/**
 * 記事ごとの OGP 画像を **ビルド時に** 静的生成するエンドポイント。
 * 出力先は dist/og/<slug>.png。ランタイム生成はしない（prerender 前提）。
 */

import type { APIRoute, GetStaticPaths } from "astro";
import { SITE } from "../../config";
import { getAllInterviews, selectorOf } from "../../lib/collections";
import { resolveCover } from "../../lib/cover";
import { fetchCoverAsDataUri } from "../../lib/og-cover";
import { renderOgImage } from "../../lib/og-template";

export const prerender = true;

export const getStaticPaths: GetStaticPaths = async () => {
  // 下書きのOGP画像は生成しない
  const interviews = await getAllInterviews();
  return Promise.all(
    interviews.map(async (entry) => {
      const firstBook = entry.data.books[0];
      const cover = firstBook ? await resolveCover(firstBook.isbn) : null;
      return {
        params: { slug: entry.data.slug },
        props: {
          title: entry.data.title,
          selectorName: selectorOf(entry).name,
          topic: entry.data.topic,
          bookTitles: entry.data.books.map((b) => b.title),
          coverUrl: cover?.url ?? null,
        },
      };
    }),
  );
};

export const GET: APIRoute = async ({ props }) => {
  const coverImage = await fetchCoverAsDataUri(props.coverUrl as string | null);

  const png = await renderOgImage({
    title: props.title as string,
    selectorName: props.selectorName as string,
    topic: props.topic as string,
    bookTitles: props.bookTitles as string[],
    siteName: SITE.name,
    coverImage,
  });

  return new Response(png as unknown as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
};
