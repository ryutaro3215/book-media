/**
 * 選者マスタ（`src/data/selectors.json`）へのアクセス。
 *
 * 記事は選者の情報を**持たず、ID だけを持つ**（`selector: yamada-taro`）。
 * 所属や略歴が変わったときにマスタ1箇所を直せば全記事に反映される。
 *
 * JSON にしているのは、Astro（TS）と CLI スクリプト（.mjs）の
 * **両方から同じファイルを読む**ため。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import selectorsJson from "../data/selectors.json";

export type Selector = {
  name: string;
  reading?: string;
  /**
   * 所属（任意）。
   *
   * **必須にしない。** 選者は大学の教員だけではなく、在野の研究者や
   * X で学術書を読み続けている人も含める、と決めている
   * （`.dev/business-plan.md` の選者資格）。所属を必須にすると
   * その母数を最初から締め出すことになる。
   *
   * 誰であるかの根拠は `credentials`（この人が詳しい理由）が担う。
   * 匿名でも「何に詳しいか」は書ける。
   */
  affiliation?: string;
  /**
   * 略歴（任意）。何をしている人か。
   *
   * **必須にしない。** 経歴として書けることが無い選者はいるが、
   * 「何に詳しいか」なら誰でも書ける。読者に必要なのは後者であり、
   * 必須にすると肩書きの無い人に経歴を捻り出させることになる。
   * 空なら表示側で出さない（`affiliation` と同じ扱い）。
   */
  bio?: string;
  /**
   * この人が詳しい理由。「なぜこの人の推薦を信じるのか」の根拠。
   *
   * **肩書きや形式は問わない。** 選者は学者に限らず、在野の研究者や
   * その領域を長く読み続けている人も含む。研究・仕事・発信・読書歴、
   * どれでもよい。
   *
   * **ただし必須。** 選者の知名度がゼロの初期段階では、ここが読者にとって
   * 唯一の手がかりになる。空だと「知らない人のおすすめリスト」になり、
   * ブクログのレビューと区別がつかなくなる（差別化の中核が消える）。
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
 * 顔写真のURL。
 *
 *   1. selectors.json の `avatar`（登録した画像）
 *   2. `public/selectors/_default.<ext>`（置いてあれば全員の既定値になる）
 *   3. どちらも無ければ null → 呼び出し側が頭文字を出す
 *
 * 2 は**ファイルを置くかどうかだけ**で切り替わる（設定は不要）。
 * ただし置くと写真のない選者が全員同じ見た目になる。
 * 頭文字は人ごとに変わるので、一覧での識別性は頭文字の方が高い。
 */
const DEFAULT_AVATAR_BASENAME = "_default";
/**
 * 顔写真として置ける拡張子。
 *
 * **`/admin/selectors` の画像アップロードもこの配列を読む**
 * （`scripts/lib/admin-dev-server.mjs` が ssrLoadModule で取る）。
 * 書き写すと、片方だけ増えたときに「置けるのに表示されない」が起きる。
 */
export const AVATAR_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;

const SELECTORS_DIR = path.resolve(process.cwd(), "public/selectors");

function findDefaultAvatar(): string | null {
  for (const ext of AVATAR_EXTENSIONS) {
    if (
      existsSync(path.join(SELECTORS_DIR, `${DEFAULT_AVATAR_BASENAME}${ext}`))
    ) {
      return `/selectors/${DEFAULT_AVATAR_BASENAME}${ext}`;
    }
  }
  return null;
}

export function getAvatarUrl(id: SelectorId): string | null {
  const avatar = selectors[id]?.avatar?.trim();
  if (avatar) return `/selectors/${avatar}`;
  return findDefaultAvatar();
}

/** 全選者を [id, 選者] の組で返す */
export function getAllSelectors(): Array<[SelectorId, Selector]> {
  return Object.entries(selectors);
}
