#!/usr/bin/env node
/**
 * ISBN の書誌カバレッジを実測する。
 *
 *   node scripts/check-isbn.mjs 9784150504106 9784622049128 ...
 *   node scripts/check-isbn.mjs --file isbns.txt      # 1行1ISBN
 *   npm run check:isbn -- 9784150504106
 *
 * openBD と Google Books の**両方**を叩いて、どちらで何が取れるかを並べて出す。
 * 「自動取得でどこまで埋まるか」を、推測ではなく実データで判断するためのもの。
 *
 * .env に GOOGLE_BOOKS_API_KEY があれば読み込む（無くても動く）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

// --- .env の最小読み込み（依存を増やさない） -------------------------
const envPath = path.resolve(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

const TIMEOUT_MS = 8000;

function parseYear(value) {
  if (typeof value !== "string") return undefined;
  const m = value.match(/(\d{4})/);
  return m ? Number(m[1]) : undefined;
}

async function openbd(isbn) {
  try {
    const res = await fetch(`https://api.openbd.jp/v1/get?isbn=${isbn}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const s = (await res.json())?.[0]?.summary;
    if (!s?.title) return null;
    return {
      title: [s.title, s.volume].filter(Boolean).join(" ").trim(),
      author: (s.author ?? "").trim(),
      publisher: (s.publisher ?? "").trim(),
      year: parseYear(s.pubdate),
      cover: (s.cover ?? "").trim() !== "",
    };
  } catch {
    return null;
  }
}

async function googlebooks(isbn) {
  try {
    const url = new URL("https://www.googleapis.com/books/v1/volumes");
    url.searchParams.set("q", `isbn:${isbn}`);
    url.searchParams.set("country", "JP");
    if (process.env.GOOGLE_BOOKS_API_KEY) {
      url.searchParams.set("key", process.env.GOOGLE_BOOKS_API_KEY);
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return { __error: `HTTP ${res.status}` };
    const v = (await res.json())?.items?.[0]?.volumeInfo;
    if (!v?.title) return null;
    return {
      title: [v.title, v.subtitle].filter(Boolean).join(" ").trim(),
      author: (v.authors ?? []).join(" / "),
      publisher: (v.publisher ?? "").trim(),
      year: parseYear(v.publishedDate),
      cover: Boolean(v.imageLinks?.thumbnail),
    };
  } catch {
    return null;
  }
}

// --- 引数 -------------------------------------------------------------
const args = process.argv.slice(2);
let isbns = [];

const fileIdx = args.indexOf("--file");
if (fileIdx !== -1 && args[fileIdx + 1]) {
  isbns = fs
    .readFileSync(args[fileIdx + 1], "utf8")
    .split("\n")
    .map((l) => l.replace(/[^\d]/g, ""))
    .filter((l) => /^\d{13}$/.test(l));
} else {
  isbns = args
    .map((a) => a.replace(/[^\d]/g, ""))
    .filter((a) => /^\d{13}$/.test(a));
}

if (isbns.length === 0) {
  console.error(`ISBN13 を指定してください。

  node scripts/check-isbn.mjs 9784150504106 9784622049128
  node scripts/check-isbn.mjs --file isbns.txt

ハイフンは自動で除去します。`);
  process.exit(1);
}

console.log(
  `\nGOOGLE_BOOKS_API_KEY: ${process.env.GOOGLE_BOOKS_API_KEY ? "あり" : "なし（キーなしでも動作します）"}`,
);
console.log(`${isbns.length}件を照会します\n`);

const stats = {
  openbdTitle: 0,
  openbdFull: 0,
  openbdCover: 0,
  gbTitle: 0,
  gbFull: 0,
  gbCover: 0,
  either: 0,
  neither: 0,
};

const isFull = (r) => Boolean(r?.title && r?.author && r?.publisher && r?.year);

for (const isbn of isbns) {
  const [o, g] = await Promise.all([openbd(isbn), googlebooks(isbn)]);

  if (o?.title) stats.openbdTitle++;
  if (isFull(o)) stats.openbdFull++;
  if (o?.cover) stats.openbdCover++;
  if (g?.title) stats.gbTitle++;
  if (isFull(g)) stats.gbFull++;
  if (g?.cover) stats.gbCover++;
  if (o?.title || g?.title) stats.either++;
  else stats.neither++;

  const show = (label, r) => {
    if (r?.__error) return `  ${label}: エラー ${r.__error}`;
    if (!r) return `  ${label}: ✗ 該当なし`;
    const missing = [
      !r.title && "書名",
      !r.author && "著者",
      !r.publisher && "出版社",
      !r.year && "刊行年",
    ].filter(Boolean);
    const mark = missing.length === 0 ? "✓" : "△";
    return [
      `  ${label}: ${mark} ${r.title}`,
      `      著者: ${r.author || "—"}`,
      `      出版: ${r.publisher || "—"} / ${r.year ?? "—"}  書影: ${r.cover ? "あり" : "なし"}`,
      missing.length ? `      欠け: ${missing.join("・")}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  };

  console.log(`ISBN ${isbn}`);
  console.log(show("openBD      ", o));
  console.log(show("GoogleBooks ", g));
  console.log("");
}

const pct = (n) =>
  `${n}/${isbns.length} (${Math.round((n / isbns.length) * 100)}%)`;

console.log("─".repeat(60));
console.log("集計");
console.log(`  openBD      書名が取れた        : ${pct(stats.openbdTitle)}`);
console.log(`              4項目すべて揃った    : ${pct(stats.openbdFull)}`);
console.log(`              書影あり            : ${pct(stats.openbdCover)}`);
console.log(`  GoogleBooks 書名が取れた        : ${pct(stats.gbTitle)}`);
console.log(`              4項目すべて揃った    : ${pct(stats.gbFull)}`);
console.log(`              書影あり            : ${pct(stats.gbCover)}`);
console.log(`  どちらかで取れた                : ${pct(stats.either)}`);
console.log(`  どちらでも取れなかった          : ${pct(stats.neither)}`);
console.log("─".repeat(60));
console.log(
  "\n※「4項目」= 書名・著者・出版社・刊行年。ここが揃わない分は手入力になります。",
);
console.log(
  "※ 記事作成時は項目ごとに良い方を採ります（plan.md T21）:\n" +
    "     書名・著者 → Google Books 優先（openBD は叢書名や図書館形式が混ざる）\n" +
    "     出版社     → openBD のみ（Google Books は返さない）\n" +
    "     刊行年     → 取れた方。食い違えば要確認として記事に書き出す\n",
);
