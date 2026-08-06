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
 *
 * ## 「同じ本が、あるページでは映って別のページでは映らない」を作らないこと
 * かつてこの処理は、呼ばれるたびに素直に外部APIを叩いていた。その結果、
 * 5冊しか引かない記事ページでは成功し、記事カードを並べるトップページでは
 * 数十冊を一斉に引いて Google Books に 429 を返され、静かにフォールバックへ倒れていた。
 * **同じISBNの答えが呼び出し地点によって変わること自体が不具合**なので、
 * 以下の3つで「1つのISBNには1つの答え」を構造として保証する。
 *
 *   - プロセス内メモ化を **DEV でも効かせる**（結果を1プロセス1回に畳む）
 *   - 外部APIへの同時接続数を絞り、429/5xx はバックオフして再試行する
 *   - 取得できたURLはディスクに残し、dev の再起動やビルドのたびに叩き直さない
 *
 * この保証は `npm run check:covers` が dist/ を走査して機械的に検査している。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  type CoverLookup,
  fetchGoogleBooksCover,
  fetchOpenBdCover,
} from "./openbd";

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

/**
 * 外部APIの結果のメモ化（値ではなく Promise を保持し、並行呼び出しも1回に畳む）。
 *
 * **DEV でも必ず効かせる。** ここを切ると同じISBNが呼ばれた回数だけAPIを叩き、
 * ページによって答えが変わる（上のコメントの不具合そのもの）。
 * 「記事を書きながら `public/covers/` に画像を足すと即反映される」という
 * dev の使い勝手は、ローカル画像の探索をこのメモ化の**外**に置くことで維持している。
 */
const remoteCache = new Map<string, Promise<CoverResult>>();

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
 * ディスクキャッシュ
 * ------------------------------------------------------------------ */

/**
 * 取得済みの書影URLの置き場。
 *
 * dev サーバーを再起動するたび・ビルドのたびに数十冊を引き直すと、
 * そのたびに 429 を踏む機会を作ることになる。**一度取れたURLは残す。**
 *
 * 取れなかった本（フォールバック）は記録しない。ネットワーク断や一時的な失敗を
 * 焼き付けてしまうと、実際には書影がある本が延々と出なくなるため。
 * その代わり、フォールバックの本は毎回引き直すコストを払う。
 */
const CACHE_FILE = path.resolve(process.cwd(), ".cache/covers.json");

/** 書影URLは差し替わりうるので永久には信じない */
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type CacheEntry = { url: string; source: CoverSource; at: number };

let diskCache: Map<string, CacheEntry> | null = null;
let diskCacheDirty = false;

function loadDiskCache(): Map<string, CacheEntry> {
  if (diskCache) return diskCache;
  diskCache = new Map();
  try {
    const raw = JSON.parse(readFileSync(CACHE_FILE, "utf8")) as Record<
      string,
      CacheEntry
    >;
    const now = Date.now();
    for (const [isbn, entry] of Object.entries(raw)) {
      if (entry?.url && now - entry.at < CACHE_TTL_MS) {
        diskCache.set(isbn, entry);
      }
    }
  } catch {
    // 無い・壊れている場合は空から始める。キャッシュはあくまで高速化なので落とさない
  }
  return diskCache;
}

function rememberOnDisk(isbn: string, result: CoverResult): void {
  if (!result.url) return;
  loadDiskCache().set(isbn, {
    url: result.url,
    source: result.source,
    at: Date.now(),
  });
  diskCacheDirty = true;
  scheduleSummary();
}

function flushDiskCache(): void {
  if (!diskCacheDirty || !diskCache) return;
  try {
    mkdirSync(path.dirname(CACHE_FILE), { recursive: true });
    writeFileSync(
      CACHE_FILE,
      `${JSON.stringify(Object.fromEntries(diskCache), null, 2)}\n`,
    );
  } catch {
    // 書けなくても表示には影響しない
  }
}

/* ------------------------------------------------------------------ *
 * 外部APIの呼び出し制御
 * ------------------------------------------------------------------ */

/**
 * 外部APIへの同時接続数の上限。
 *
 * 実測: 30件を一斉に投げると Google Books は 24件を 429 で返した。
 * 記事が増えるほどトップページの一斉問い合わせは増えるので、
 * **冊数に比例して壊れない**ように入口で絞る。ビルドは数秒遅くなるが、
 * 書影が出たり出なかったりするほうが害が大きい。
 */
const MAX_CONCURRENCY = 4;

/** 429 を踏んだときの再試行間隔（ms）。回数ぶん待って諦める */
const RETRY_DELAYS_MS = [400, 1200, 3000];

let inFlight = 0;
const waiting: Array<() => void> = [];

async function withLimit<T>(task: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  inFlight += 1;
  try {
    return await task();
  } finally {
    inFlight -= 1;
    waiting.shift()?.();
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 「書影が無い」ときは1回で諦め、「今は答えられない」ときだけ待って引き直す。
 *
 * 書影を持たない本は珍しくない（とくに絶版本）。それを再試行すると
 * 1冊あたり数秒を無駄に払うことになるので、`none` は即座に確定させる。
 * 待つ価値があるのは 429 やタイムアウト、つまり `unavailable` のときだけ。
 */
async function fetchWithRetry(
  fetcher: (isbn: string) => Promise<CoverLookup>,
  isbn: string,
): Promise<string | null> {
  let lookup = await withLimit(() => fetcher(isbn));

  for (const delay of RETRY_DELAYS_MS) {
    if (lookup.status !== "unavailable") break;
    await sleep(delay);
    lookup = await withLimit(() => fetcher(isbn));
  }

  return lookup.status === "found" ? lookup.url : null;
}

async function resolveRemote(isbn: string): Promise<CoverResult> {
  const cached = loadDiskCache().get(isbn);
  if (cached) return { url: cached.url, source: cached.source };

  // ① openBD
  const openbd = await fetchWithRetry(fetchOpenBdCover, isbn);
  if (openbd) return { url: openbd, source: "openbd" };

  // ② Google Books
  const google = await fetchWithRetry(fetchGoogleBooksCover, isbn);
  if (google) return { url: google, source: "googlebooks" };

  // ③ フォールバック（BookCover が縦組みの面を描く）
  return { url: null, source: "fallback" };
}

/**
 * ISBNから書影URLを解決する。ビルド時専用。
 * 失敗しても例外は投げず、必ず `CoverResult` を返す。
 *
 * 同じISBNに対しては、**どのページのどのコンポーネントから呼んでも同じ答えを返す。**
 */
export function resolveCover(isbn: string): Promise<CoverResult> {
  // 自前の画像だけはメモ化の外。dev 中に public/covers/ へ足した画像を
  // サーバー再起動なしで反映させたい（ここは外部APIを叩かないので何度見ても安い）
  const local = findLocalCover(isbn);
  if (local) {
    const result: CoverResult = { url: local, source: "local" };
    countOnce(isbn, result);
    return Promise.resolve(result);
  }

  const cached = remoteCache.get(isbn);
  if (cached) return cached;

  const pending = resolveRemote(isbn)
    .catch((): CoverResult => ({ url: null, source: "fallback" }))
    .then((result) => {
      countOnce(isbn, result);
      rememberOnDisk(isbn, result);
      return result;
    });

  remoteCache.set(isbn, pending);
  return pending;
}

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

  if (missing.size === 0) return head;

  // どの本に画像を用意すればよいかを、ISBNをコピーできる形で出す
  const list = [...missing.entries()]
    .map(([isbn, title]) => `    ${isbn}  ${title}`)
    .join("\n");

  return `${head}\n  書影なし（public/covers/<ISBN>.jpg に置くと反映されます）:\n${list}`;
}

/**
 * ビルドの最後に一度だけサマリを出し、ディスクキャッシュを書き出す。
 * 各解決ごとに出すとログが埋まるため、プロセス終了時にまとめる。
 */
function scheduleSummary(): void {
  if (summaryScheduled) return;
  summaryScheduled = true;
  process.once("exit", () => {
    flushDiskCache();
    // eslint-disable-next-line no-console
    console.log(coverSummary());
  });
}
