#!/usr/bin/env node
/**
 * 記事に出てくる本の書影URLを引いて `src/data/covers.json` に記録する。
 *
 *   npm run sync:covers              記録の無い本だけ引く
 *   npm run sync:covers -- --force   記録済みも引き直す（URLが腐ったとき）
 *
 * ## ここが唯一、書影のために外部APIを叩く場所
 * ビルドと dev は `src/data/covers.json` を読むだけにしてある（`src/lib/cover.ts`）。
 * 表示のたびに引いていた頃は、Google Books の1日あたりの上限を使い切ると
 * **書影が一斉に消えた**。しかも本番ビルドは Cloudflare 上で走るので、
 * 手元では見えているのに本番だけ落ちるということが起こりうる。
 *
 * ## 記録するもの・しないもの
 *   found       → URLを記録する
 *   none        → `url: null` を記録する。**「書影が無い」ことも答えなので残す。**
 *                 残さないと絶版本を毎回引き直すことになる
 *   unavailable → 記録しない。429 やタイムアウトは本の性質ではなく、
 *                 そのときの都合。焼き付けると本当は書影のある本が出なくなる
 *
 * この区別が無かったために、上限超過が「書影なし」として扱われていた。
 *
 * ## 画像そのものは落とさない
 * 自サイトから配信すると複製・公衆送信にあたり、出版社の許諾が要る
 * （`docs/covers.md`）。記録するのはURLだけ。許諾が取れた本は
 * `public/covers/` に置く（`/admin` から置ける）。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  hasLocalCover,
  lookupCover,
  REGISTRY_PATH,
  readRegistry,
  writeRegistry,
} from "./lib/cover-lookup.mjs";
import { loadEnv } from "./lib/prompt.mjs";

const ROOT = process.cwd();
const ARTICLES_DIR = path.join(ROOT, "src/content/interviews");

loadEnv(path.join(ROOT, ".env"));

const force = process.argv.includes("--force");

/** 同時接続の上限。実測で30件を一斉に投げると Google Books は24件を429で返した */
const MAX_CONCURRENCY = 4;

/* ------------------------------------------------------------------ *
 * 本体
 * ------------------------------------------------------------------ */

function collectIsbns() {
  const found = new Map();
  if (!fs.existsSync(ARTICLES_DIR)) return found;
  for (const file of fs
    .readdirSync(ARTICLES_DIR)
    .filter((f) => f.endsWith(".md"))) {
    const text = fs.readFileSync(path.join(ARTICLES_DIR, file), "utf8");
    const titles = [...text.matchAll(/^ {2}- title: "(.*)"$/gm)].map(
      (m) => m[1],
    );
    const isbns = [...text.matchAll(/^ {4}isbn: "(\d{13})"$/gm)].map(
      (m) => m[1],
    );
    isbns.forEach((isbn, i) => {
      if (!found.has(isbn)) found.set(isbn, titles[i] ?? "");
    });
  }
  return found;
}

const registry = readRegistry();

const all = collectIsbns();
const targets = [...all.keys()].filter((isbn) => {
  // 自前画像がある本は引く必要がない（表示でも自前が最優先）
  if (hasLocalCover(isbn)) return false;
  return force || !(isbn in registry);
});

console.log(
  `記事に出てくる本: ${all.size}冊 / 記録済み: ${Object.keys(registry).length}件`,
);
if (targets.length === 0) {
  console.log("引く対象はありません。");
  process.exit(0);
}
console.log(`これから引く: ${targets.length}冊${force ? "（--force）" : ""}\n`);

const today = new Date().toISOString().slice(0, 10);
let found = 0;
let none = 0;
const unavailable = [];

let cursor = 0;
async function worker() {
  while (cursor < targets.length) {
    const isbn = targets[cursor++];
    const r = await lookupCover(isbn);
    if (!r) {
      unavailable.push(isbn);
      console.log(`  ${isbn}  — 取得できず（時間をおいて再実行）`);
      continue;
    }
    registry[isbn] = { url: r.url, source: r.source, at: today };
    if (r.url) {
      found++;
      console.log(`  ${isbn}  ${r.source}`);
    } else {
      none++;
      console.log(`  ${isbn}  書影なし`);
    }
  }
}

await Promise.all(
  Array.from({ length: Math.min(MAX_CONCURRENCY, targets.length) }, worker),
);

writeRegistry(registry);

console.log(
  `\n書影あり ${found} / 書影なし ${none} / 取得できず ${unavailable.length}`,
);
if (unavailable.length > 0) {
  console.log(
    "\n取得できなかった本は記録していません（一時的な失敗を焼き付けないため）。",
  );
  console.log(
    "Google Books の1日あたりの上限に当たっている可能性があります。日を改めて再実行してください。",
  );
}
console.log(`\n${path.relative(ROOT, REGISTRY_PATH)} を更新しました。`);
