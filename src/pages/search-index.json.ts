import type { APIRoute } from "astro";
import { getCollection } from "astro:content";

/**
 * 検索用の静的インデックス（requirements R17a）。
 *
 * サーバーも外部検索サービスも使わず、ビルド時に生成したこのJSONを
 * クライアント側で絞り込む。記事100本以下なら数十KBに収まるため、
 * 静的配信・無料枠・攻撃面ゼロという前提をすべて維持できる。
 *
 * 本文は含めない（全文検索は非スコープ。インデックスが肥大するため）。
 */
export const GET: APIRoute = async () => {
  const interviews = await getCollection("interviews");

  const index = interviews
    .sort(
      (a, b) =>
        b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf(),
    )
    .map((entry) => ({
      slug: entry.id,
      title: entry.data.title,
      topic: entry.data.topic,
      selector: entry.data.selector.name,
      affiliation: entry.data.selector.affiliation,
      publishedAt: entry.data.publishedAt.toISOString().slice(0, 10),
      books: entry.data.books.map((b) => b.title),
      authors: entry.data.books.map((b) => b.author),
    }));

  return new Response(JSON.stringify(index), {
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
};
