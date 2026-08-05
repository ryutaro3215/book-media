#!/usr/bin/env node
/**
 * ビルド後に、日本語フォントを**実際に使われている文字だけ**に絞る。
 *
 *   npm run build   （astro build の後に自動で走る）
 *
 * ## なぜ必要か
 * 日本語のWebフォントは1ウェイト約 966KB あり、3ウェイトで **2.9MB**。
 * これはページ総転送量の **99.6%** を占めていた（HTML 6KB / CSS 5.5KB / JS 0）。
 * しかも `<link rel="preload">` で最優先に取りに行くため、モバイル回線を直撃する。
 * 主要導線がXからのモバイル流入なので、ここは事業上も効く。
 *
 * ## なぜ「固定の文字セット」ではなく「実際に使われた文字」か
 * JIS第1水準などの固定セットで絞ると、**書名や著者名の旧字体・異体字が欠ける**。
 * 本を扱うメディアでは実際に起こりうる（『藝術』『權力』など）。
 * ビルド結果から文字を集めれば、欠けようがない。
 *
 * ## 対象
 * `dist/` の HTML と JSON（検索インデックス）に出てくる文字。
 * 記事を追加すればビルドのたびに再生成されるので、取りこぼさない。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import subsetFont from "subset-font";

const ROOT = process.cwd();
const DIST = path.join(ROOT, "dist");
const FONT_DIR = path.join(DIST, "fonts");

if (!fs.existsSync(DIST)) {
  console.error("dist/ がありません。先に astro build を実行してください。");
  process.exit(1);
}

/** dist 配下から、指定拡張子のファイルを再帰的に集める */
function collect(dir, extensions) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(full, extensions));
    else if (extensions.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

// --- 使われている文字を集める ---------------------------------------
const sources = collect(DIST, [".html", ".json", ".xml"]);
const chars = new Set();

for (const file of sources) {
  for (const ch of fs.readFileSync(file, "utf8")) chars.add(ch);
}

/**
 * 常に含める文字。
 * 記事が増えたときに毎回サブセットが変わるのは避けられないが、
 * よく使う記号・かな・英数字は固定で入れておくと差分が小さくなる。
 */
const ALWAYS =
  "0123456789" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz" +
  "、。，．・：；？！゛゜´｀¨＾￣＿ヽヾゝゞ〃仝々〆〇ー―‐／＼〜‖｜…‥" +
  "‘’“”（）〔〕［］｛｝〈〉《》「」『』【】＋－±×÷＝≠＜＞≦≧∞∴♂♀°′″℃￥＄￠￡％＃＆＊＠§☆★○●◎◇◆□■△▲▽▼※〒→←↑↓〓" +
  "ぁあぃいぅうぇえぉおかがきぎくぐけげこごさざしじすずせぜそぞただちぢっつづてでとどなにぬねのはばぱひびぴふぶぷへべぺほぼぽまみむめもゃやゅゆょよらりるれろゎわゐゑをん" +
  "ァアィイゥウェエォオカガキギクグケゲコゴサザシジスズセゼソゾタダチヂッツヅテデトドナニヌネノハバパヒビピフブプヘベペホボポマミムメモャヤュユョヨラリルレロヮワヰヱヲンヴヵヶ";

for (const ch of ALWAYS) chars.add(ch);

const text = [...chars].join("");

// --- サブセット化 ----------------------------------------------------
const targets = fs
  .readdirSync(FONT_DIR)
  .filter((f) => f.includes("japanese") && f.endsWith(".woff2"));

if (targets.length === 0) {
  console.log("[fonts] 日本語フォントが見つかりません（スキップ）");
  process.exit(0);
}

let before = 0;
let after = 0;

for (const file of targets) {
  const full = path.join(FONT_DIR, file);
  const original = fs.readFileSync(full);
  before += original.length;

  try {
    const subset = await subsetFont(original, text, { targetFormat: "woff2" });
    fs.writeFileSync(full, subset);
    after += subset.length;
  } catch (err) {
    // 失敗してもビルドは壊さない。元のフォントがそのまま残るだけ
    console.error(`[fonts] ${file} のサブセット化に失敗: ${err.message}`);
    after += original.length;
  }
}

const kb = (n) => `${Math.round(n / 1024).toLocaleString()}KB`;
const cut = Math.round((1 - after / before) * 100);

console.log(
  `[fonts] ${targets.length}ファイル / ${chars.size}文字 — ` +
    `${kb(before)} → ${kb(after)}（${cut}%削減）`,
);
