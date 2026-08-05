/**
 * 選者マスタ（`src/data/selectors.json`）へのアクセス。
 *
 * 記事は選者の情報を**持たず、ID だけを持つ**（`selector: yamada-taro`）。
 * 所属や略歴が変わったときにマスタ1箇所を直せば全記事に反映される。
 *
 * JSON にしているのは、Astro（TS）と CLI スクリプト（.mjs）の
 * **両方から同じファイルを読む**ため。
 */
import selectorsJson from "../data/selectors.json";

export type Selector = {
  name: string;
  reading?: string;
  affiliation: string;
  bio: string;
  /**
   * 公開された実績。「なぜこの人の推薦を信じるのか」の根拠。
   *
   * ブクログとの差別化が「誰が薦めたか」である以上、名前と所属だけでは
   * 「その人が詳しい」根拠にならない。読者が納得できる材料をここに書く。
   * 例: 論文・著書／担当した本・作った棚／その領域での公開された仕事
   */
  credentials: string;
  /**
   * 顔写真のファイル名（任意）。`public/selectors/` に置いた画像を指す。
   * 例: `matsuba.jpg`
   *
   * **必須にはしない。** 研究者が写真提供を渋る場合があり、
   * 必須にすると取材のたびに交渉が発生する。
   * 未指定なら頭文字のアバターを表示するので、一覧が崩れることはない。
   */
  avatar?: string;
  links?: {
    x?: string;
    site?: string;
  };
};

export type SelectorId = string;

const selectors = selectorsJson as Record<SelectorId, Selector>;

/** 登録済みの選者ID一覧 */
export const SELECTOR_IDS = Object.keys(selectors);

/** IDが登録されているか。content.config.ts の検証に使う */
export function isKnownSelector(id: string): boolean {
  return Object.hasOwn(selectors, id);
}

/**
 * IDから選者を引く。
 * スキーマ側で存在を検証しているため、ここに来る時点で必ず存在する。
 */
export function getSelector(id: SelectorId): Selector {
  const selector = selectors[id];
  if (!selector) {
    throw new Error(
      `選者 "${id}" が src/data/selectors.json に存在しません。` +
        `登録済み: ${SELECTOR_IDS.join(", ")}`,
    );
  }
  return selector;
}

/**
 * 顔写真のURL。未登録なら null。
 * `public/selectors/` に置いたファイル名をそのまま参照する。
 */
export function getAvatarUrl(id: SelectorId): string | null {
  const avatar = selectors[id]?.avatar?.trim();
  return avatar ? `/selectors/${avatar}` : null;
}

/** 全選者を [id, 選者] の組で返す */
export function getAllSelectors(): Array<[SelectorId, Selector]> {
  return Object.entries(selectors);
}
