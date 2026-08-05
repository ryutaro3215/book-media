/**
 * 記事コレクションの集計（plan.md T13 / T14）。
 *
 * 記事（interviews）から「選者ごと」「分野ごと」のまとまりを作る。
 * `src/content.config.ts` は変更しないため、選者IDも分野IDも
 * **frontmatter の文字列そのもの**（`selector.name` / `topic`）を正規化して使う。
 *
 * URL の方針:
 *   - 分野名・選者名は日本語なので、ローマ字化はせず **そのまま URL セグメントにし、
 *     リンク生成時に `encodeURIComponent` する**（`toTopicHref` / `toSelectorHref`）。
 *   - `getStaticPaths` に渡す params には**生の文字列**を渡す（Astro 側がエンコードする）。
 *   この2点を守れば、日本語のスラグでもリンクと出力パスが必ず一致する。
 */
import { getCollection, type CollectionEntry } from "astro:content";

export type Interview = CollectionEntry<"interviews">;

export type SelectorGroup = {
  /** URL に使うID（＝正規化した選者名） */
  id: string;
  /** 選者情報。同名の選者が複数記事を持つ場合は最新記事のものを採用する */
  selector: Interview["data"]["selector"];
  /** 公開日の新しい順 */
  articles: Interview[];
  /** その選者が扱った分野（重複なし・記事の新しい順） */
  topics: string[];
};

export type TopicGroup = {
  /** URL に使うID（＝正規化した分野名） */
  id: string;
  /** 表示名 */
  name: string;
  /** 公開日の新しい順 */
  articles: Interview[];
};

/** 前後の空白と全角空白を落としただけの正規化。表記はいじらない */
function normalize(value: string): string {
  return value.replace(/[\s　]+/g, " ").trim();
}

/** 公開日の新しい順 */
function byPublishedAtDesc(a: Interview, b: Interview): number {
  return b.data.publishedAt.getTime() - a.data.publishedAt.getTime();
}

/** 全記事を公開日の新しい順で取得する */
export async function getAllInterviews(): Promise<Interview[]> {
  const entries = await getCollection("interviews");
  return [...entries].sort(byPublishedAtDesc);
}

/** 選者ごとにグルーピングする（記事数の多い順 → 名前順） */
export async function getSelectorGroups(
  entries?: Interview[],
): Promise<SelectorGroup[]> {
  const all = entries ?? (await getAllInterviews());
  const map = new Map<string, SelectorGroup>();

  for (const entry of all) {
    const id = normalize(entry.data.selector.name);
    const existing = map.get(id);
    if (existing) {
      existing.articles.push(entry);
    } else {
      map.set(id, {
        id,
        // all は新しい順なので、最初に現れた記事＝最新のプロフィールを採用する
        selector: entry.data.selector,
        articles: [entry],
        topics: [],
      });
    }
  }

  const groups = [...map.values()];
  for (const group of groups) {
    group.articles.sort(byPublishedAtDesc);
    group.topics = [
      ...new Set(group.articles.map((a) => normalize(a.data.topic))),
    ];
  }

  return groups.sort(
    (a, b) =>
      b.articles.length - a.articles.length || a.id.localeCompare(b.id, "ja"),
  );
}

/** 分野ごとにグルーピングする（記事数の多い順 → 分野名順） */
export async function getTopicGroups(
  entries?: Interview[],
): Promise<TopicGroup[]> {
  const all = entries ?? (await getAllInterviews());
  const map = new Map<string, TopicGroup>();

  for (const entry of all) {
    const id = normalize(entry.data.topic);
    const existing = map.get(id);
    if (existing) {
      existing.articles.push(entry);
    } else {
      map.set(id, { id, name: id, articles: [entry] });
    }
  }

  const groups = [...map.values()];
  for (const group of groups) group.articles.sort(byPublishedAtDesc);

  return groups.sort(
    (a, b) =>
      b.articles.length - a.articles.length || a.name.localeCompare(b.name, "ja"),
  );
}

/** 選者ページのURL */
export function toSelectorHref(name: string): string {
  return `/selectors/${encodeURIComponent(normalize(name))}/`;
}

/** 分野ページのURL */
export function toTopicHref(topic: string): string {
  return `/topics/${encodeURIComponent(normalize(topic))}/`;
}

/** 記事ページのURL（`src/pages/[slug].astro` に対応。ルート直下） */
export function toArticleHref(entry: Interview): string {
  return `/${entry.data.slug}/`;
}

/** Xのプロフィールへの絶対URL。`@` 付き・素のハンドル・URL のいずれでも受ける */
export function toXProfileUrl(handle: string | undefined): string | null {
  if (!handle) return null;
  const value = handle.trim();
  if (!value) return null;
  if (/^https?:\/\//.test(value)) return value;
  return `https://x.com/${value.replace(/^@/, "")}`;
}

/** 表示用のハンドル（先頭に `@` を付けた形） */
export function toXHandleLabel(handle: string | undefined): string | null {
  if (!handle) return null;
  const value = handle.trim().replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//, "");
  if (!value) return null;
  return value.startsWith("@") ? value : `@${value}`;
}

/** 「2026年8月4日」 */
export function formatDate(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/** `<time datetime>` 用の `YYYY-MM-DD` */
export function toISODate(date: Date): string {
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}
