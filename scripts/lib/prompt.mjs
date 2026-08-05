/**
 * 対話式スクリプトの共通部品。
 *
 * `new-article.mjs` と `new-selector.mjs` で共有する。
 *
 * ## パイプ入力への対応
 * readline はパイプが EOF に達すると close し、以降の question() が
 * 解決されないまま終了してしまう（テストや自動実行が黙って途中で止まる）。
 * そのため **TTY でないときは先に全行を読み込んでおく**。
 */
import fs from "node:fs";
import { stdin as input, stdout as output } from "node:process";
import readline from "node:readline/promises";

const interactive = input.isTTY;

let rl = null;
let queued = [];

if (interactive) {
  rl = readline.createInterface({ input, output });
} else {
  const chunks = [];
  for await (const chunk of input) chunks.push(chunk);
  queued = Buffer.concat(chunks).toString("utf8").split("\n");
}

export async function ask(question) {
  if (interactive) return rl.question(question);
  const line = queued.length > 0 ? queued.shift() : "";
  output.write(`${question}${line}\n`);
  return line;
}

export function closeInput() {
  rl?.close();
}

/** 空を許さない入力。initial があれば Enter でそれを採用する */
export async function askRequired(label, initial = "") {
  while (true) {
    const suffix = initial ? `（現在: ${initial} / Enterでそのまま）` : "";
    const answer = (await ask(`${label}${suffix}: `)).trim();
    if (answer) return answer;
    if (initial) return initial;
    console.log("  ※ 必須です");
  }
}

/** 一覧から選ばせる。allowNew を渡すと「n」で新規を選べる */
export async function chooseFromList(
  label,
  items,
  { allowNew = false, newLabel = "新規に追加する" } = {},
) {
  console.log(`\n${label}`);
  for (const [i, item] of items.entries()) {
    console.log(`  ${i + 1}. ${item.label}`);
  }
  if (allowNew) console.log(`  n. ${newLabel}`);

  while (true) {
    const answer = (await ask("番号を入力: ")).trim();
    if (allowNew && answer.toLowerCase() === "n") return { isNew: true };
    const idx = Number(answer) - 1;
    if (Number.isInteger(idx) && idx >= 0 && idx < items.length) {
      return { isNew: false, value: items[idx].value };
    }
    console.log("  ※ 一覧の番号を入力してください");
  }
}

export const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
export const writeJson = (p, data) =>
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`);

/** .env の最小読み込み（依存を増やさない） */
export function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

/** 半角小文字英数とハイフンのID候補を作る */
export function toIdCandidate(text) {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * 選者を1人ぶん対話で作る。
 * `new-article.mjs` の中からも、`new-selector.mjs` からも呼ぶ。
 *
 * @returns {Promise<{id: string, selector: object}>}
 */
export async function promptSelector(existingIds = []) {
  const name = await askRequired("  氏名");

  let id = "";
  const suggestion = toIdCandidate(name);
  while (!/^[a-z0-9][a-z0-9-]*$/.test(id) || existingIds.includes(id)) {
    const hint = suggestion ? `（例: ${suggestion}）` : "";
    id = (await ask(`  ID（URLになる。半角小文字英数とハイフン）${hint}: `))
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      console.log("  ※ 半角小文字の英数とハイフンだけで入力してください");
    } else if (existingIds.includes(id)) {
      console.log(`  ※ ID「${id}」は既に使われています`);
      id = "";
    }
  }

  const reading = (await ask("  ふりがな（任意）: ")).trim();
  const affiliation = await askRequired("  所属");
  const bio = await askRequired("  略歴（何をしている人か、1〜2文）");

  console.log(
    "\n  ■ この人が詳しい理由\n" +
      "    「なぜこの人の推薦を信じるのか」の根拠になります。\n" +
      "    **肩書きや形式は問いません。** 研究・仕事・発信・読書歴など。\n" +
      "    例:\n" +
      "      ・〇〇について15年読み続けている。△△で書評を書いている\n" +
      "      ・在野で〇〇史を調べており、Xで継続的に書いている\n" +
      "      ・△△出版で人文書の編集を担当\n" +
      "    読者が「この人の話なら聞いてみたい」と思える材料を書いてください。",
  );
  const credentials = await askRequired("  この人が詳しい理由");

  console.log(
    "\n  ■ 顔写真（任意）\n" +
      "    public/selectors/ に画像を置き、ファイル名を入力してください（例: matsuba.jpg）。\n" +
      "    未登録なら氏名の頭文字が円形に表示されます。",
  );
  const avatar = (await ask("  ファイル名: ")).trim();

  const x = (await ask("  Xのハンドル（@なし・任意）: ")).trim();
  const site = (await ask("  サイトURL（任意）: ")).trim();

  const selector = {
    name,
    ...(reading ? { reading } : {}),
    affiliation,
    bio,
    credentials,
    ...(avatar ? { avatar } : {}),
    ...(x || site
      ? { links: { ...(x ? { x } : {}), ...(site ? { site } : {}) } }
      : {}),
  };

  return { id, selector };
}
