/**
 * 書影の解決（plan.md T5）。
 *
 * **この処理はビルド時にのみ走る。** Astro のコンポーネントから `await resolveCover(isbn)`
 * を呼ぶことで静的HTMLにURLが焼き込まれ、クライアント側でAPIを叩くコードは出力されない。
 *
 * 優先順位:
 *   1. `public/covers/<isbn>.jpg|.png|.webp`（自前で用意した画像。許諾取得済みのもの）
 *   2. openBD API
 *   3. Google Books API
 *   4. 見つからなければ `null` → BookCover が縦組みのフォールバック面を描画する
 *
 * どの経路でも例外を投げない。APIが落ちていてもビルドは必ず成功する。
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { fetchGoogleBooksCover, fetchOpenBdCover } from "./openbd";

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

const LOCAL_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;

/** 同一ISBNを何度も引かないためのメモ化（値ではなく Promise を保持し、並行呼び出しも1回に畳む） */
const cache = new Map<string, Promise<CoverResult>>();

/** ビルドログのサマリ用カウンタ */
const tally: Record<CoverSource, number> = {
  local: 0,
  openbd: 0,
  googlebooks: 0,
  fallback: 0,
};

let summaryScheduled = false;

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

async function resolveUncached(isbn: string): Promise<CoverResult> {
  // ① 自前の画像
  const local = findLocalCover(isbn);
  if (local) return { url: local, source: "local" };

  // ② openBD
  const openbd = await fetchOpenBdCover(isbn);
  if (openbd) return { url: openbd, source: "openbd" };

  // ③ Google Books
  const google = await fetchGoogleBooksCover(isbn);
  if (google) return { url: google, source: "googlebooks" };

  // ④ フォールバック（BookCover が縦組みの面を描く）
  return { url: null, source: "fallback" };
}

/**
 * ISBNから書影URLを解決する。ビルド時専用。
 * 失敗しても例外は投げず、必ず `CoverResult` を返す。
 */
export function resolveCover(isbn: string): Promise<CoverResult> {
  const cached = cache.get(isbn);
  if (cached) return cached;

  const pending = resolveUncached(isbn)
    .catch((): CoverResult => ({ url: null, source: "fallback" }))
    .then((result) => {
      tally[result.source] += 1;
      scheduleSummary();
      return result;
    });

  cache.set(isbn, pending);
  return pending;
}

/** 解決結果のサマリ文字列（テスト・手動確認用） */
export function coverSummary(): string {
  const total = Object.values(tally).reduce((a, b) => a + b, 0);
  return (
    `[cover] ${total}冊 — ` +
    `自前 ${tally.local} / openBD ${tally.openbd} / ` +
    `GoogleBooks ${tally.googlebooks} / フォールバック ${tally.fallback}`
  );
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
