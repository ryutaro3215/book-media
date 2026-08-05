#!/usr/bin/env node
/**
 * ビルド結果から、ローカル専用の画面を消す。
 *
 *   npm run build   （astro build の後に自動で走る）
 *
 * ## なぜ必要か
 * `/admin` は記事ファイルを書くための画面で、公開ディレクトリに置く理由が
 * ひとつも無い。`import.meta.env.DEV` を見て中身は描画しないようにしてあるが、
 * **画面の存在自体を残さない**。守りを二重にして、片方が将来壊れても
 * 事故にならないようにしてある。
 *
 * 裏側の口（/api/…）は Vite の `apply: "serve"` プラグインなので
 * そもそもビルドに入らない（scripts/lib/admin-dev-server.mjs）。
 * ここで `api` も対象にしているのは、将来 `src/pages/api/` に何か置かれても
 * 気づかず公開されないようにするため。
 *
 * 消し忘れではなく消したことを確かめたいので、結果を必ず出力する。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const DIST = path.join(process.cwd(), "dist");

/** 公開してはいけないパス（dist からの相対） */
const TARGETS = ["admin", "admin.html", "api"];

if (!fs.existsSync(DIST)) {
  console.error("dist/ がありません。先に astro build を実行してください。");
  process.exit(1);
}

const removed = [];
for (const target of TARGETS) {
  const full = path.join(DIST, target);
  if (fs.existsSync(full)) {
    fs.rmSync(full, { recursive: true, force: true });
    removed.push(target);
  }
}

console.log(
  removed.length > 0
    ? `[admin] dist から除外: ${removed.join(" / ")}`
    : "[admin] 除外対象はありませんでした（ビルドに含まれていない）",
);

// 消し漏れが無いか、最後にもう一度見る。
// ここで残っていたら TARGETS の書き漏らしなので、ビルドを失敗させる
const leftovers = fs
  .readdirSync(DIST)
  .filter((name) => name === "admin" || name === "api");

if (leftovers.length > 0) {
  console.error(`[admin] 除外できていません: ${leftovers.join(" / ")}`);
  process.exit(1);
}
