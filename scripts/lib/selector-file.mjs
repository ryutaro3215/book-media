/**
 * 選者マスタ（`src/data/selectors.json`）の読み書きと検証。
 *
 * CLI（`npm run new:selector`）と `/admin/selectors` の**両方から使う**。
 * `article-file.mjs` を CLI と /admin で共有しているのと同じ理由で、
 * 「どちらから登録したかで結果が変わる」状態を作らないために1箇所にまとめてある。
 *
 * ここは `.mjs` なので `src/lib/selectors.ts` の型は使えないが、
 * **保存する形（キーの順序・任意項目を空で書かない扱い）はこのファイルが決める。**
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SELECTORS_PATH = path.join(ROOT, "src/data/selectors.json");

/** 顔写真の置き場所。`src/lib/selectors.ts` の `/selectors/<ファイル名>` に対応する */
export const AVATARS_DIR = path.join(ROOT, "public/selectors");

/**
 * ID の形。**URL（`/selectors/<id>/`）になる。**
 * 日本語やスペースを混ぜると、リンクの見た目が壊れるうえに
 * 記事側の `selector:` に書き写すのが難しくなる。
 */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function readSelectors() {
  return JSON.parse(fs.readFileSync(SELECTORS_PATH, "utf8"));
}

export function writeSelectors(selectors) {
  fs.writeFileSync(
    SELECTORS_PATH,
    `${JSON.stringify(selectors, null, 2)}\n`,
    "utf8",
  );
  return SELECTORS_PATH;
}

/**
 * 氏名から ID の候補を作る。ローマ字化まではしない
 * （日本語の氏名から機械的に作れないため、画面側で直す前提の下書き）。
 */
export function toIdCandidate(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * 保存できる形に整える。**任意項目は空なら書かない。**
 *
 * `"affiliation": ""` のような空文字を残すと、表示側で
 * 「所属あり」と判定されて `（）` だけが出る。CLI 側も同じ扱いにしてある。
 */
export function buildSelector(input) {
  const trim = (v) => String(v ?? "").trim();

  const reading = trim(input.reading);
  const affiliation = trim(input.affiliation);
  const bio = trim(input.bio);
  const avatar = trim(input.avatar);
  // Xのハンドルは `@` を付けない（`src/data/selectors.json` の links.x）。
  // 貼り付けたURLごと入れられることもあるので、そこまで剥がす
  const x = trim(input.x)
    .replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\//i, "")
    .replace(/^@/, "")
    .replace(/[/?].*$/, "");
  const site = trim(input.site);

  return {
    name: trim(input.name),
    ...(reading ? { reading } : {}),
    ...(affiliation ? { affiliation } : {}),
    ...(bio ? { bio } : {}),
    credentials: trim(input.credentials),
    ...(avatar ? { avatar } : {}),
    ...(x || site
      ? { links: { ...(x ? { x } : {}), ...(site ? { site } : {}) } }
      : {}),
  };
}

/**
 * 保存前の検証。**ファイルを書く直前がここ。**
 *
 * 通してしまうと、記事側が `selector:` で参照した瞬間にビルドが落ちる
 * （`src/content.config.ts` が登録済みIDしか許さない）。
 * そのときエラーに出るのは記事の名前なので、原因が選者マスタにあると気づきにくい。
 */
export function validateSelector({ id, selector, existingIds, editing }) {
  const errors = [];

  if (!id) errors.push("ID が未入力です");
  else if (!ID_PATTERN.test(id)) {
    errors.push("ID は半角小文字の英数とハイフンのみ（先頭はハイフン以外）");
  } else if (!editing && existingIds.includes(id)) {
    errors.push(`ID「${id}」は既に使われています`);
  } else if (editing && !existingIds.includes(id)) {
    errors.push(`ID「${id}」は登録されていません`);
  }

  if (!selector.name) errors.push("氏名が未入力です");
  // 略歴（bio）は必須にしない。何をしている人かを言えない選者はいるが、
  // 「何に詳しいか」なら誰でも書ける。読者に必要なのは後者で、
  // 必須にすると肩書きの無い人に無理やり経歴を書かせることになる
  //
  // 空だと「知らない人のおすすめリスト」になる。credentials を必須にしている
  // 理由は README「credentials を必須にしている理由」を参照
  if (!selector.credentials) {
    errors.push("「この人が詳しい理由」が未入力です");
  }

  const site = selector.links?.site;
  if (site && !/^https?:\/\//.test(site)) {
    errors.push("サイトURL は http:// または https:// から始めてください");
  }

  return errors;
}

/**
 * 検証は通るが、人が見て確かめたほうがよいこと。
 * **保存は妨げない**（画面に出すだけ）。
 */
export function selectorWarnings(selector) {
  const warnings = [];

  const avatar = selector.avatar;
  if (avatar && !fs.existsSync(path.join(AVATARS_DIR, avatar))) {
    warnings.push(
      `public/selectors/${avatar} がまだありません（このままだと画像が出ません）`,
    );
  }

  return warnings;
}
