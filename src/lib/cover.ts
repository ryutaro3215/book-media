/**
 * 書影の解決（plan.md T5 / T28）。
 *
 * **ビルド時も dev も、ここから外部APIを叩くことはない。**
 * 解決済みのURLは `src/data/covers.json`（リポジトリに入っている）に記録してあり、
 * ここはそれを読むだけ。
 *
 * 優先順位:
 *   1. `public/covers/<isbn>.jpg|.png|.webp`（自前で用意した画像。許諾取得済みのもの）
 *   2. `src/data/covers.json` に記録済みのURL
 *   3. どちらも無ければ `null` → BookCover が縦組みのフォールバック面を描画する
 *
 * ## なぜ表示のたびに引かないのか
 * 以前はビルドのたび・dev で開くたびに外部APIを叩いていた。実害が3つ出た。
 *
 *   - **Google Books の1日あたりの上限を使い切ると、書影が一斉に消える。**
 *     429 は「書影が無い」と区別がつかないまま `null` になっていた
 *   - **本番ビルドは Cloudflare 上で走る。** そこで上限に当たれば、
 *     手元では見えていた書影が**本番だけ落ちる**
 *   - キャッシュが `process.cwd()` 基準だったため、**ワークツリーを移ると空**になり、
 *     前は映っていた本が映らなくなった
 *
 * 書影は本ごとに一度決まれば変わらない性質のものなので、
 * **登録のときに一度だけ引いて、結果をリポジトリに持つ**のが素直だった。
 *
 * ## 画像そのものはダウンロードしない
 * 自サイトから配信すると書影の複製・公衆送信にあたり、出版社の許諾が要る
 * （`docs/covers.md`）。外部URLを参照するのとは法的な扱いが違うため、
 * **記録するのはURLだけ**にしてある。許諾が取れた本は
 * `public/covers/` に置く（`/admin` から置ける）。
 *
 * 代わりに**URLは腐りうる**。`npm run check:covers` がリンク切れを検査する。
 *
 * ## 引き直すとき
 *   npm run sync:covers        記録の無い本だけ引く
 *   npm run sync:covers -- --force   記録済みも引き直す
 * この2つのコマンドを叩いたときだけ外部APIに触れる。
 */
import { existsSync } from "node:fs";
import path from "node:path";

import registry from "../data/covers.json";

export type CoverSource = "local" | "openbd" | "googlebooks" | "fallback";

export type CoverResult = {
  /** 書影のURL。解決できなかった場合は null */
  url: string | null;
  /** どの経路で解決したか */
  source: CoverSource;
};

/**
 * `public/covers/` の絶対パス。
 * このモジュールはビルド時にバンドルされて `dist/.prerender/` 配下から実行されるため、
 * `import.meta.url` からの相対では解決できない。ビルドの cwd（プロジェクトルート）を基準にする。
 */
const COVERS_DIR = path.resolve(process.cwd(), "public/covers");

/**
 * 自前画像として認める拡張子。**先に書いたものが勝つ。**
 *
 * `/admin` のアップロード（scripts/lib/admin-dev-server.mjs）も許可リストとして
 * これを読む。置ける形式と表示できる形式がずれると、
 * 「アップロードできたのに書影が変わらない」という気づきにくい状態になる。
 */
export const LOCAL_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;

/** ビルドログのサマリ用カウンタ */
const tally: Record<CoverSource, number> = {
  local: 0,
  openbd: 0,
  googlebooks: 0,
  fallback: 0,
};

/** 書影が見つからなかった本。ビルド後に「どれに画像を用意すべきか」を出すため */
const missing = new Map<string, string>();

let summaryScheduled = false;

/**
 * 書影が見つからなかった本を記録する。
 * BookCard から書名つきで呼ぶことで、ログに書名を出せる。
 */
export function noteMissingCover(isbn: string, title: string): void {
  missing.set(isbn, title);
}

/**
 * `public/covers/<isbn>.<ext>` を探す。あればサイト上のパスを返す。
 */
function findLocalCover(isbn: string): string | null {
  for (const ext of LOCAL_EXTENSIONS) {
    if (existsSync(path.join(COVERS_DIR, `${isbn}${ext}`))) {
      return `/covers/${isbn}${ext}`;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * 記録済みURL
 * ------------------------------------------------------------------ */

/**
 * `src/data/covers.json` の中身。
 *
 * **リポジトリに入っている**のが要点。`.cache/` に置いていた頃は
 * `process.cwd()` 基準だったため、ワークツリーを移ると空になり、
 * CI と手元でも別物だった。git に入れれば、どこでビルドしても同じ絵になる。
 *
 * `url: null` は「引いたが書影が無かった」。**これも記録する。**
 * 記録しないと、書影を持たない本を引き直し続けることになる
 * （絶版本は珍しくない）。429 やタイムアウトは記録しない
 * （`sync-covers.mjs` 側で弾いている）ので、一時的な失敗が焼き付くことはない。
 */
type RegistryEntry = { url: string | null; source: CoverSource; at: string };

const REGISTRY = registry as Record<string, RegistryEntry>;

/**
 * ISBNから書影URLを解決する。ビルド時専用。
 * 失敗しても例外は投げず、必ず `CoverResult` を返す。
 *
 * 同じISBNに対しては、**どのページのどのコンポーネントから呼んでも同じ答えを返す。**
 */
export function resolveCover(isbn: string): Promise<CoverResult> {
  // 自前の画像を最優先で見る。ここはメモ化もキャッシュも挟まないので、
  // dev 中に public/covers/ へ置いた画像がサーバー再起動なしで反映される
  // （ファイルの有無を見るだけなので、何度呼んでも安い）
  const local = findLocalCover(isbn);
  if (local) {
    const result: CoverResult = { url: local, source: "local" };
    countOnce(isbn, result);
    return Promise.resolve(result);
  }

  const entry = REGISTRY[isbn];
  const result: CoverResult = entry?.url
    ? { url: entry.url, source: entry.source }
    : { url: null, source: "fallback" };

  // 記録が無い本は、まだ一度も引いていない。ログで分かるようにしておく
  if (!entry) unregistered.add(isbn);

  countOnce(isbn, result);
  return Promise.resolve(result);
}

/** まだ `src/data/covers.json` に記録が無いISBN。`npm run sync:covers` を促すため */
const unregistered = new Set<string>();

/**
 * 複数冊をまとめて解決する。
 *
 * BookCard（記事ページ）と ArticleThumbnail（記事カード）の**両方がこれを使う**。
 * 呼び出し側それぞれが `Promise.all` を書くと、そこが片方だけ変わる余地になるため、
 * 「冊数ぶんの書影を引く」という操作自体を1箇所に持つ。
 */
export async function resolveCovers(
  books: ReadonlyArray<{ isbn: string; title: string }>,
): Promise<Array<{ isbn: string; title: string } & CoverResult>> {
  return Promise.all(
    books.map(async (book) => ({
      isbn: book.isbn,
      title: book.title,
      ...(await resolveCover(book.isbn)),
    })),
  );
}

/** 同じ本を2度数えないためのカウント済みISBN（サマリの数字を冊数と一致させる） */
const counted = new Set<string>();

function countOnce(isbn: string, result: CoverResult): void {
  if (counted.has(isbn)) return;
  counted.add(isbn);
  tally[result.source] += 1;
  scheduleSummary();
}

/** 解決結果のサマリ文字列（テスト・手動確認用） */
export function coverSummary(): string {
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  const head =
    `[cover] ${total}冊 — ` +
    `自前 ${tally.local} / openBD ${tally.openbd} / ` +
    `GoogleBooks ${tally.googlebooks} / フォールバック ${tally.fallback}`;

  const lines: string[] = [head];

  if (unregistered.size > 0) {
    lines.push(
      `  未記録 ${unregistered.size}冊 — npm run sync:covers で引けます:`,
      ...[...unregistered].map((isbn) => `    ${isbn}`),
    );
  }

  if (missing.size === 0) return lines.join("\n");

  // どの本に画像を用意すればよいかを、ISBNをコピーできる形で出す
  const list = [...missing.entries()]
    .map(([isbn, title]) => `    ${isbn}  ${title}`)
    .join("\n");

  lines.push(
    "  書影なし（public/covers/<ISBN>.jpg に置くと反映されます）:",
    list,
  );
  return lines.join("\n");
}

/**
 * ビルドの最後に一度だけサマリを出す。
 * 各解決ごとに出すとログが埋まるため、プロセス終了時にまとめる。
 */
function scheduleSummary(): void {
  if (summaryScheduled) return;
  summaryScheduled = true;
  process.once("exit", () => {
    // eslint-disable-next-line no-console
    console.log(coverSummary());
  });
}
