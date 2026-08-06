/**
 * 書影URLの取得と、`src/data/covers.json` への記録。
 *
 * **書影のために外部APIを叩くのは、このモジュールを通る経路だけ。**
 * 呼ぶのは2つ:
 *   - `npm run sync:covers`（scripts/sync-covers.mjs）
 *   - `/admin` で ISBN を入れて「取得」を押したとき（admin-dev-server.mjs）
 *
 * ビルドと dev の表示は `src/lib/cover.ts` が記録を読むだけで、APIに触れない。
 * 表示のたびに引いていた頃は、Google Books の1日あたりの上限を使い切ると
 * **書影が一斉に消えた**。本番ビルドは Cloudflare 上で走るので、
 * 手元では見えているのに本番だけ落ちる、ということも起こりうる。
 *
 * ## 記録するもの・しないもの
 *   found       → URLを記録する
 *   none        → `url: null` を記録する。**「書影が無い」ことも答え。**
 *                 残さないと絶版本を毎回引き直すことになる
 *   unavailable → 記録しない。429 やタイムアウトは本の性質ではなく、
 *                 そのときの都合。焼き付けると本当は書影のある本が出なくなる
 *
 * この区別が無かったために、上限超過が「書影なし」と同じ扱いになっていた。
 *
 * ## 画像そのものは落とさない
 * 自サイトから配信すると複製・公衆送信にあたり、出版社の許諾が要る
 * （`docs/covers.md`）。記録するのはURLだけ。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
export const REGISTRY_PATH = path.join(ROOT, "src/data/covers.json");
const COVERS_DIR = path.join(ROOT, "public/covers");

/** `src/lib/cover.ts` の LOCAL_EXTENSIONS と同じ並び（先に見つかった方が勝つ） */
export const LOCAL_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];

const TIMEOUT_MS = 8000;

async function fetchOpenBd(isbn) {
  try {
    const res = await fetch(`https://api.openbd.jp/v1/get?isbn=${isbn}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429 || res.status >= 500)
      return { status: "unavailable" };
    if (!res.ok) return { status: "none" };
    const url = (await res.json())?.[0]?.summary?.cover;
    return url ? { status: "found", url } : { status: "none" };
  } catch {
    return { status: "unavailable" };
  }
}

async function fetchGoogleBooks(isbn) {
  try {
    const u = new URL("https://www.googleapis.com/books/v1/volumes");
    u.searchParams.set("q", `isbn:${isbn}`);
    u.searchParams.set("country", "JP");
    if (process.env.GOOGLE_BOOKS_API_KEY) {
      u.searchParams.set("key", process.env.GOOGLE_BOOKS_API_KEY);
    }
    const res = await fetch(u, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 429 || res.status >= 500)
      return { status: "unavailable" };
    if (!res.ok) return { status: "none" };
    const links = (await res.json())?.items?.[0]?.volumeInfo?.imageLinks;
    const url = links?.thumbnail ?? links?.smallThumbnail;
    // Google は http で返すことがある。https のページに混ぜると読み込まれない
    return url
      ? { status: "found", url: url.replace(/^http:/, "https:") }
      : { status: "none" };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * openBD → Google Books の順に引く。
 * どちらかが `unavailable` なら**結論を出さない**（null を返す）。
 * 「今は答えられない」を「書影が無い」として記録しないため。
 */
export async function lookupCover(isbn) {
  const o = await fetchOpenBd(isbn);
  if (o.status === "found") return { url: o.url, source: "openbd" };

  const g = await fetchGoogleBooks(isbn);
  if (g.status === "found") return { url: g.url, source: "googlebooks" };

  if (o.status === "unavailable" || g.status === "unavailable") return null;
  return { url: null, source: "fallback" };
}

export function hasLocalCover(isbn) {
  return LOCAL_EXTENSIONS.some((ext) =>
    fs.existsSync(path.join(COVERS_DIR, `${isbn}${ext}`)),
  );
}

export function readRegistry() {
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
  } catch {
    return {};
  }
}

/** ISBN順に並べて書く。差分が読めるようにするため */
export function writeRegistry(registry) {
  const sorted = Object.fromEntries(
    Object.keys(registry)
      .sort()
      .map((k) => [k, registry[k]]),
  );
  fs.writeFileSync(REGISTRY_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
}

/**
 * 1冊ぶんを引いて記録する。既に記録があればAPIに触れない。
 * `/admin` の「取得」から呼ぶ。**登録の瞬間が、書影を引く唯一のタイミング。**
 */
export async function lookupAndRemember(isbn, { force = false } = {}) {
  if (hasLocalCover(isbn)) return null; // 自前画像が最優先。引く必要がない

  const registry = readRegistry();
  if (!force && isbn in registry) return registry[isbn];

  const r = await lookupCover(isbn);
  if (!r) return null; // unavailable。記録しない

  const entry = {
    url: r.url,
    source: r.source,
    at: new Date().toISOString().slice(0, 10),
  };
  registry[isbn] = entry;
  writeRegistry(registry);
  return entry;
}
