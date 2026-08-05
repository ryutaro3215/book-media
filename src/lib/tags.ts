/**
 * タグ（小ジャンル）のマスタ（`src/data/tags.json`）。
 *
 * ## topic との違い
 *   topic = **大ジャンル**（必須・1つ）。例: 数学 / 経営学 / 統計学
 *   tags  = **小ジャンル**（任意・複数）。例: 解析学 / 測度論 / 多変量解析
 *
 * 「数学」と「解析学」はレイヤーが違うのに、単一軸だと同じ場所に並んでしまう。
 * 登録のたびにどちらのレベルで入れるか迷い、放置すると粒度の違うページが
 * `/topics/` に混在する。そこで軸を分けた。
 *
 * ## 語彙を閉じている理由
 * topic と同じ。自由入力にすると「多変量解析」「多変量解析法」のように
 * 表記が揺れ、集約されなくなる。追記の一手間が抑止として働く。
 *
 * ## 専用ページを作っていない理由
 * 記事が少ないうちにタグページを作ると、**1記事しか無いページが量産される**。
 * 薄いページは検索エンジンにインデックスされにくく、回遊にも寄与しない。
 * 当面はタグを**検索へのリンク**として扱う（`/search?q=<タグ>`）。
 * 記事が増えて1タグあたり複数記事になったら、ページ化を検討する。
 */
import tagsJson from "../data/tags.json";

export type TagMeta = Record<string, never>;

const tags = tagsJson as Record<string, TagMeta>;

/** 登録済みのタグ名 */
export const TAG_NAMES = Object.keys(tags);

/** 登録されているか。content.config.ts の検証に使う */
export function isKnownTag(name: string): boolean {
  return Object.hasOwn(tags, name);
}

/** タグのリンク先。専用ページは作らず検索に飛ばす */
export function toTagHref(name: string): string {
  return `/search?q=${encodeURIComponent(name)}`;
}
