#!/usr/bin/env node
/**
 * ビルド結果の内部リンクが実在するページを指しているか検査する。
 *
 *   npm run check:links
 *
 * ## なぜ必要か
 * 選者マスタへ移行したとき、`selector.name`（氏名）でURLを組み立てている
 * 箇所が2つ残り、存在しない `/selectors/山田太郎/` にリンクしていた。
 * **ビルドも型チェックもLintも通ったため検出できなかった。**
 * この種の不具合は実際にリンクを辿らないと分からないので、CIで機械的に見る。
 *
 * 日本語URLはエンコードされているのでデコードしてから照合する。
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

/** サイト内リンクが指す先が存在するか */
function exists(href) {
  const clean = decodeURIComponent(href.split("#")[0].split("?")[0]);
  if (clean === "/") return fs.existsSync(path.join(DIST, "index.html"));

  const target = path.join(DIST, clean);
  // /foo/ → dist/foo/index.html
  if (clean.endsWith("/"))
    return fs.existsSync(path.join(target, "index.html"));
  // /foo.png のような実ファイル、または /foo → dist/foo/index.html
  return (
    fs.existsSync(target) || fs.existsSync(path.join(target, "index.html"))
  );
}

const files = htmlFiles(DIST);
const broken = [];
let checked = 0;

for (const file of files) {
  const html = fs.readFileSync(file, "utf8");
  const hrefs = [...html.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map(
    (m) => m[1],
  );
  for (const href of new Set(hrefs)) {
    checked++;
    if (!exists(href)) {
      broken.push({ from: path.relative(DIST, file), href });
    }
  }
}

console.log(`${files.length}ページ・${checked}件のリンクを検査しました`);

if (broken.length > 0) {
  console.error(`\n✗ リンク切れ ${broken.length}件\n`);
  for (const b of broken) console.error(`  ${b.href}\n    ← ${b.from}`);
  console.error("");
  process.exit(1);
}

console.log("✓ リンク切れはありません");
