#!/usr/bin/env node
/**
 * 同じ本の書影が、ページによって出たり出なかったりしていないか検査する。
 *
 *   npm run check:covers
 *
 * ## なぜ必要か
 * 書影の解決はページを描くたびに外部APIを叩いていたため、5冊しか引かない
 * 記事ページでは成功し、記事カードを並べるトップページでは数十冊を一斉に引いて
 * Google Books に 429 を返され、**同じ本がサムネイルでだけ消えていた。**
 * ビルドも型チェックもLintも通り、ログにも異常は出ない（フォールバックは
 * 正規の表示なので）。実際の出力を突き合わせないと分からないので機械的に見る。
 *
 * 判定は「1つのISBNに対する結論がサイト全体で1つであること」だけ。
 * 書影が取れない本があること自体は正常なので、フォールバックの数では落とさない。
 * 検査できるように BookCover / ArticleThumbnail は `data-isbn` を出力している。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DIST = path.resolve(process.cwd(), "dist");

if (!fs.existsSync(DIST)) {
  console.error("dist/ がありません。先に npm run build を実行してください。");
  process.exit(1);
}

/** dist 配下の .html を再帰的に集める */
function htmlFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFiles(full));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

/**
 * `data-isbn` を持つ要素から「その本がどう描かれたか」を1つ拾う。
 * img なら src、そうでなければフォールバック面。
 */
function readOutcome(tag) {
  const isbn = tag.match(/data-isbn="(\d{13})"/)?.[1];
  if (!isbn) return null;
  if (!tag.startsWith("<img")) return { isbn, outcome: "フォールバック" };
  const src = tag.match(/\ssrc="([^"]*)"/)?.[1];
  return {
    isbn,
    outcome: src ? `書影 ${src.replace(/&amp;/g, "&")}` : "空のsrc",
  };
}

/** ISBN → 結論 → それが現れたページ */
const seen = new Map();
let elements = 0;

for (const file of htmlFiles(DIST)) {
  const html = fs.readFileSync(file, "utf8");
  const page = `/${path.relative(DIST, file)}`;
  for (const [tag] of html.matchAll(
    /<(?:img|div)\b[^>]*data-isbn="[^"]*"[^>]*>/g,
  )) {
    const read = readOutcome(tag);
    if (!read) continue;
    elements += 1;
    if (!seen.has(read.isbn)) seen.set(read.isbn, new Map());
    const outcomes = seen.get(read.isbn);
    if (!outcomes.has(read.outcome)) outcomes.set(read.outcome, []);
    outcomes.get(read.outcome).push(page);
  }
}

const conflicts = [...seen.entries()].filter(([, o]) => o.size > 1);

if (conflicts.length > 0) {
  console.error(
    `同じ本の書影がページによって違います（${conflicts.length}件）:\n`,
  );
  for (const [isbn, outcomes] of conflicts) {
    console.error(`  ${isbn}`);
    for (const [outcome, pages] of outcomes) {
      console.error(`    ${outcome}`);
      for (const page of pages.slice(0, 3)) console.error(`      ← ${page}`);
    }
  }
  console.error(
    "\n書影の解決は src/lib/cover.ts に一本化されています。" +
      "外部APIの一時的な失敗（429 など）を掴んでいないか確認してください。",
  );
  process.exit(1);
}

const fallbacks = [...seen.entries()].filter(([, o]) =>
  o.has("フォールバック"),
).length;

console.log(
  `書影の一貫性: ${seen.size}冊 / ${elements}箇所 — すべて同じ結論` +
    (fallbacks > 0 ? `（うち ${fallbacks}冊 はフォールバック表示）` : ""),
);
