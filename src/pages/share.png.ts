/**
 * X に添付する紹介画像（1200×675・16:9）。
 *
 *   npm run build → dist/share.png
 *
 * ## OGPカードとは別物
 * リンクを貼ればOGPカード（`/og-default.png`・1200×630）が自動で出る。
 * **ただし画像を添付するとカードは出なくなる。** どちらか一方しか表示されない。
 * この画像は「カードの代わりに、もっと伝わる面を出したい」ときのためのもの。
 *
 * ## 何を載せるか
 * **実際の記事タイトルを並べる。** 「こういうメディアです」という説明より、
 * 中身が3本見えている方が、読む価値があるかを判断できる。
 * 記事が増えれば自動で新しいものに入れ替わるので、作り直さなくてよい。
 */
import type { APIRoute } from "astro";
import { SITE } from "../config";
import { getAllInterviews } from "../lib/collections";
import { renderShareImage } from "../lib/og-template";

export const prerender = true;

export const GET: APIRoute = async () => {
  const articles = await getAllInterviews();

  // 新しい順。同じ分野が続くと「1分野だけの媒体」に見えるので分野は散らす
  const sorted = [...articles].sort(
    (a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime(),
  );
  const picked: typeof sorted = [];
  const usedTopics = new Set<string>();
  for (const a of sorted) {
    if (usedTopics.has(a.data.topic)) continue;
    usedTopics.add(a.data.topic);
    picked.push(a);
    if (picked.length === 3) break;
  }
  // 分野が3つに満たなければ、残りは新しい順で埋める
  for (const a of sorted) {
    if (picked.length === 3) break;
    if (!picked.includes(a)) picked.push(a);
  }

  const png = await renderShareImage({
    siteName: SITE.name,
    lead: [
      "学びはじめるための、知のデータベースをつくっています。",
      "どの分野にも、最初に読むべき数冊がある。",
      "その領域に詳しい人が選んだ本を、分野をまたいで集めています。",
    ],
    articles: picked.map((a) => ({
      topic: a.data.topic,
      title: a.data.title,
    })),
    footnote: `${SITE.url.replace(/^https?:\/\//, "")}　全${articles.length}本`,
  });

  return new Response(png as unknown as BodyInit, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
