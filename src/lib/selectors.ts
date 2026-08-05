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
  /** 公開された実績。「なぜこの人の推薦を信じるのか」の根拠 */
  credentials: string;
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

/** 全選者を [id, 選者] の組で返す */
export function getAllSelectors(): Array<[SelectorId, Selector]> {
  return Object.entries(selectors);
}
