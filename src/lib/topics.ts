/**
 * テーマ（お題）のマスタ（`src/data/topics.json`）。
 *
 * 語彙を閉じているのは表記揺れを防ぐため。
 * 未登録の値を記事に書くとビルドが失敗する（content.config.ts で検証）。
 *
 * `description` は任意。記事が増えるとテーマページが
 * 「〇〇 おすすめ本」のような検索の受け皿になるが、
 * **記事リストだけのページはインデックスされにくい**ため、
 * 書けるテーマには説明文を持たせられるようにしてある。
 * 空文字のままでも表示に影響はない（その場合は出力しない）。
 */
import topicsJson from "../data/topics.json";

export type TopicMeta = {
  /** テーマページに出す説明文。空なら出力しない */
  description?: string;
};

const topics = topicsJson as Record<string, TopicMeta>;

/** 登録済みのテーマ名 */
export const TOPIC_NAMES = Object.keys(topics);

/** 登録されているか。content.config.ts の検証に使う */
export function isKnownTopic(name: string): boolean {
  return Object.hasOwn(topics, name);
}

/** テーマの説明文。未設定なら null */
export function getTopicDescription(name: string): string | null {
  const description = topics[name]?.description?.trim();
  return description ? description : null;
}
