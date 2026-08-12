/**
 * トピックのマスタ（`src/data/topics.json`）。
 *
 * ## 2階層にしている理由
 * 「数学」と「解析学」はレイヤーが違うのに、単一軸だと同じ場所に並ぶ。
 * 登録のたびにどちらのレベルで入れるか迷い、放置すると粒度の違うページが
 * `/topics/` に混在する。
 *
 *   大トピック（topic）    必須・1つ。**ページが生成される**（/topics/数学/）
 *   小トピック（subtopic） 任意・1つ。**ページは作らない**（検索で引ければよい）
 *   タグ（tags）           任意・複数。同上（src/lib/tags.ts）
 *
 * ## 小トピックにページを作らない理由
 * 記事が少ないうちは1記事しか無いページが量産される。薄いページは
 * インデックスされにくく、回遊にも寄与しない。検索で引ければ用は足りる。
 *
 * ## どの小トピックにも当てはまらないとき
 * 各大トピックの先頭に **「〇〇全般」**（`数学全般` など）を置いてある。
 * 記事が分野を横断していたり、入門的で特定の下位分野に寄らない場合に使う。
 * 無いと、当てはまらないのに近そうな小トピックを選ぶか、空にするかの
 * 二択になり、**前者だと誤った分類が残り、後者だと検索から漏れる**。
 *
 * 「全般」ではなく「〇〇全般」と大トピック名を含めているのは、
 * 小トピックが記事ページでタグとして表示され、検索語にもなるため。
 * 単に「全般」だと、どの分野の全般なのか分からず、検索でも混ざる。
 *
 * ## 小トピック名は大トピックをまたいで重複する
 * 「天体物理学」は物理学にも天文学にもある（学際分野なので当然）。
 * したがって**検証は「その大トピックに属するか」で行う**。全体で一意ではない。
 */
import topicsJson from "../data/topics.json";

export type TopicMeta = {
  /** テーマページに出す説明文。空なら出力しない */
  description?: string;
  /** その大トピックに属する小トピック */
  subtopics: string[];
};

const topics = topicsJson as Record<string, TopicMeta>;

/** 登録済みの大トピック名 */
export const TOPIC_NAMES = Object.keys(topics);

/** 登録されているか。content.config.ts の検証に使う */
export function isKnownTopic(name: string): boolean {
  return Object.hasOwn(topics, name);
}

/** その大トピックに属する小トピックか */
export function isKnownSubtopic(topic: string, subtopic: string): boolean {
  return topics[topic]?.subtopics.includes(subtopic) ?? false;
}

/** 大トピックに属する小トピックの一覧 */
export function getSubtopics(topic: string): string[] {
  return topics[topic]?.subtopics ?? [];
}

/** テーマの説明文。未設定なら null */
export function getTopicDescription(name: string): string | null {
  const description = topics[name]?.description?.trim();
  return description ? description : null;
}
