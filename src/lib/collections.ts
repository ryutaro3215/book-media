/**
 * 記事コレクションの集計（plan.md T13 / T14）。
 *
 * 記事（interviews）から「選者ごと」「テーマごと」のまとまりを作る。
 *
 * 選者は `src/data/selectors.json` のマスタをIDで参照する。
 * 記事側は `selector: yamada-taro` のようにIDだけを持つので、
 * 所属や略歴が変わってもマスタ1箇所の修正で全記事に反映される。
 *
 * URL の方針:
 *   - 選者は**ASCIIのID**をそのまま使う（`/selectors/yamada-taro/`）。
 *   - テーマ名は日本語なので、ローマ字化はせず **そのまま URL セグメントにし、
 *     リンク生成時に `encodeURIComponent` する**（`toTopicHref`）。
 *   - `getStaticPaths` に渡す params には**生の文字列**を渡す（Astro 側がエンコードする）。
 */
import { type CollectionEntry, getCollection } from "astro:content";
import { getSelector, type Selector } from "./selectors";

export type Interview = CollectionEntry<"interviews">;

export type SelectorGroup = {
  /** URL に使うID（＝selectors.json のキー） */
  id: string;
  /** マスタから解決した選者情報 */
  selector: Selector;
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

/**
 * 全記事を公開日の新しい順で取得する。
 *
 * **本番ビルドでは下書き（`draft: true`）を除外する。**
 * 開発サーバーでは含めるので、書きかけの記事を見ながら書ける。
 *
 * 記事を扱うページは必ずこの関数を通すこと。
 * `getCollection("interviews")` を直接呼ぶと下書きが本番に漏れる。
 */
export async function getAllInterviews(): Promise<Interview[]> {
  const entries = await getCollection("interviews");
  const visible = import.meta.env.DEV
    ? entries
    : entries.filter((entry) => !entry.data.draft);
  return [...visible].sort(byPublishedAtDesc);
}

/** 選者ごとにグルーピングする（記事数の多い順 → 名前順） */
export async function getSelectorGroups(
  entries?: Interview[],
): Promise<SelectorGroup[]> {
  const all = entries ?? (await getAllInterviews());
  const map = new Map<string, SelectorGroup>();

  for (const entry of all) {
    const id = entry.data.selector;
    const existing = map.get(id);
    if (existing) {
      existing.articles.push(entry);
    } else {
      map.set(id, {
        id,
        selector: getSelector(id),
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
      b.articles.length - a.articles.length ||
      a.name.localeCompare(b.name, "ja"),
  );
}

/** 選者ページのURL */
export function toSelectorHref(id: string): string {
  return `/selectors/${id}/`;
}

/** 記事の選者をマスタから解決する */
export function selectorOf(entry: Interview): Selector {
  return getSelector(entry.data.selector);
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
  const value = handle
    .trim()
    .replace(/^https?:\/\/(www\.)?(x|twitter)\.com\//, "");
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
