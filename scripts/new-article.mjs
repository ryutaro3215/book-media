#!/usr/bin/env node
/**
 * 記事の雛形を作る対話式スクリプト。
 *
 *   npm run new:article
 *
 * ## 何をするか
 *   1. テーマを既存の語彙から選ばせる（新規は明示的に追加させる）
 *   2. 選者をマスタから選ばせる（新規はその場で登録できる）
 *   3. ISBN13 を5冊分入力させ、**openBD と Google Books から書誌を自動取得**する
 *   4. 取得した値を**画面に出して確認・修正させる**
 *   5. `src/content/interviews/<slug>.md` を書き出す
 *
 * ## 設計上の前提
 * 書誌は自動取得できても**そのままでは使えない**。実測で分かったこと:
 *   - openBD は出版社が確実に取れるが、著者が図書館形式（`Locke,John,1632-1704`）
 *   - Google Books は著者がきれいだが、**出版社を返さない**（0/10）
 *   - 書名にシリーズ名や文庫番号が混入することがある
 * したがって「項目ごとに良い方を採ってマージ → 人が確認」という流れを必ず通す。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  ask,
  askRequired,
  chooseFromList,
  closeInput,
  loadEnv,
  promptSelector,
  readJson,
  writeJson,
} from "./lib/prompt.mjs";

const ROOT = process.cwd();
const TOPICS_PATH = path.join(ROOT, "src/data/topics.json");
const SELECTORS_PATH = path.join(ROOT, "src/data/selectors.json");
const ARTICLES_DIR = path.join(ROOT, "src/content/interviews");

// .env（GOOGLE_BOOKS_API_KEY）を読む
loadEnv(path.join(ROOT, ".env"));

// ---------------------------------------------------------------- 書誌取得

const TIMEOUT_MS = 8000;

function parseYear(value) {
  const m = typeof value === "string" ? value.match(/(\d{4})/) : null;
  return m ? Number(m[1]) : undefined;
}

/** openBD の著者は「Locke,John,1632-1704 加藤,節,1944-」のような図書館形式 */
function cleanOpenBdAuthor(raw) {
  if (!raw) return "";
  return raw
    .split(/[／/]/)[0]
    .replace(/,\s*\d{4}-(?:\d{4})?/g, "") // 生没年を落とす
    .replace(/\s*(著|編|編著|監修)$/, "")
    .trim();
}

async function fetchOpenBd(isbn) {
  try {
    const res = await fetch(`https://api.openbd.jp/v1/get?isbn=${isbn}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const s = (await res.json())?.[0]?.summary;
    if (!s?.title) return null;
    return {
      title: String(s.title).trim(),
      volume: String(s.volume ?? "").trim(),
      author: cleanOpenBdAuthor(s.author),
      authorRaw: String(s.author ?? "").trim(),
      publisher: String(s.publisher ?? "").trim(),
      year: parseYear(s.pubdate),
    };
  } catch {
    return null;
  }
}

async function fetchGoogleBooks(isbn) {
  try {
    const url = new URL("https://www.googleapis.com/books/v1/volumes");
    url.searchParams.set("q", `isbn:${isbn}`);
    url.searchParams.set("country", "JP");
    if (process.env.GOOGLE_BOOKS_API_KEY) {
      url.searchParams.set("key", process.env.GOOGLE_BOOKS_API_KEY);
    }
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const v = (await res.json())?.items?.[0]?.volumeInfo;
    if (!v?.title) return null;
    return {
      title: String(v.title).trim(),
      author: (v.authors ?? [])[0] ?? "",
      translator: (v.authors ?? [])[1] ?? "",
      publisher: String(v.publisher ?? "").trim(),
      year: parseYear(v.publishedDate),
    };
  } catch {
    return null;
  }
}

/**
 * 実測にもとづく項目ごとの優先順位:
 *   書名   openBD（volume は混入しやすいので採らない）→ Google Books
 *   著者   Google Books（表示用の形）→ openBD（整形後）
 *   出版社 openBD のみ（Google Books は返さない）
 *   刊行年 openBD → Google Books
 */
async function fetchBook(isbn) {
  const [o, g] = await Promise.all([fetchOpenBd(isbn), fetchGoogleBooks(isbn)]);
  if (!o && !g) return { found: false, sources: [] };

  const sources = [o && "openBD", g && "GoogleBooks"].filter(Boolean);
  return {
    found: true,
    sources,
    title: o?.title || g?.title || "",
    author: g?.author || o?.author || "",
    translator: g?.translator || "",
    publisher: o?.publisher || g?.publisher || "",
    year: o?.year ?? g?.year ?? "",
    // 確認画面で「どちらが何を返したか」を見せるための生データ
    raw: { openbd: o, googlebooks: g },
  };
}

// ---------------------------------------------------------------- 入力補助

/** YAML のブロックスカラー（|）で安全に書く */
function block(text, indent) {
  const pad = " ".repeat(indent);
  return `|\n${text
    .split("\n")
    .map((line) => pad + line)
    .join("\n")}`;
}

function yamlString(value) {
  // コロン・記号を含む可能性があるので常にクォートする
  return JSON.stringify(String(value));
}

// ---------------------------------------------------------------- 本体

async function main() {
  console.log("\n記事の雛形を作ります。Ctrl+C でいつでも中断できます。\n");

  const topics = readJson(TOPICS_PATH);
  const selectors = readJson(SELECTORS_PATH);

  // --- テーマ ---
  const topicChoice = await chooseFromList(
    "■ テーマ（お題）を選んでください",
    Object.keys(topics).map((t) => ({ label: t, value: t })),
    { allowNew: true },
  );

  let topic;
  if (topicChoice.isNew) {
    console.log(
      "\n  新しいテーマを追加します。\n" +
        "  ※ このメディアの価値は「その道に詳しい人しか知らない本」にあります。\n" +
        "    お題を立てる前に確認してください:\n" +
        "      ・なぜこの人に聞くのか（選者の専門性が要るお題か）\n" +
        "      ・有名でない本が出てくるか（「知られていない理由」が書けるか）\n",
    );
    topic = await askRequired("  テーマ名");
    console.log(
      "\n  テーマの説明文（任意・Enterでスキップ）\n" +
        "  テーマページに表示されます。記事リストだけのページは検索エンジンに\n" +
        "  インデックスされにくいため、書けるなら書いておくと効きます。",
    );
    const topicDescription = (await ask("  説明文: ")).trim();
    topics[topic] = { description: topicDescription };
    writeJson(TOPICS_PATH, topics);
    console.log(`  → src/data/topics.json に「${topic}」を追加しました`);
  } else {
    topic = topicChoice.value;
  }

  // --- 選者 ---
  const selectorChoice = await chooseFromList(
    "\n■ 選者を選んでください",
    Object.entries(selectors).map(([id, s]) => ({
      label: `${s.name}（${s.affiliation}）  [${id}]`,
      value: id,
    })),
    { allowNew: true },
  );

  let selectorId;
  if (selectorChoice.isNew) {
    console.log("\n  新しい選者を登録します。");
    const created = await promptSelector(Object.keys(selectors));
    selectorId = created.id;
    selectors[selectorId] = created.selector;
    writeJson(SELECTORS_PATH, selectors);
    console.log(
      `  → src/data/selectors.json に「${created.selector.name}」を追加しました`,
    );
  } else {
    selectorId = selectorChoice.value;
  }

  const selectorName = selectors[selectorId].name;

  // --- 記事のメタ情報 ---
  console.log("\n■ 記事の情報");

  // タイトルは自動生成しない。雛形は出すが、選ぶか自分で書くかは毎回決めてもらう。
  // タイトルは記事ごとに考える価値のある要素で、型に流し込むと全記事が同じ顔になる
  console.log("\n  記事タイトル");
  const titleChoice = await chooseFromList(
    "  雛形から選ぶか、自由に入力してください",
    [
      {
        label: `${selectorName}が選ぶ、${topic}の5冊`,
        value: `${selectorName}が選ぶ、${topic}の5冊`,
      },
      {
        label: `${topic}を知るための5冊 — ${selectorName}が選ぶ`,
        value: `${topic}を知るための5冊 — ${selectorName}が選ぶ`,
      },
      {
        label: `${selectorName}が薦める、${topic}の隠れた5冊`,
        value: `${selectorName}が薦める、${topic}の隠れた5冊`,
      },
    ],
    { allowNew: true, newLabel: "自由に入力する" },
  );
  const title = titleChoice.isNew
    ? await askRequired("  タイトル")
    : titleChoice.value;

  // 検索用タイトル（任意）。
  // 記事タイトルは「〈選者〉が選ぶ、〈テーマ〉の5冊」の型で、X共有時に
  // 「誰が選んだか」を伝えるための形。一方で検索する人は
  // 「〇〇 入門書」「〇〇 おすすめ 本」と打つため、語が噛み合わない。
  // 両立させるために、<title> だけ差し替えられるようにしてある。
  console.log(
    "\n  検索用タイトル（任意・Enterでスキップ）\n" +
      "  検索結果に出る <title> だけを差し替えます。上のタイトルはそのまま残ります。\n" +
      `  例: ${topic}の入門書5冊 — ${selectorName}が選ぶ`,
  );
  const seoTitle = (await ask("  検索用タイトル: ")).trim();

  // slug は必ず半角英数とハイフンにする。
  // 日本語のままだと共有時にURLがエンコードされて長大化する（Xでの共有が主要導線）。
  // 一度公開したURLは変えられないので、ここで弾く
  let slug = "";
  while (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    slug = (
      await ask(
        `  slug（URLになる。半角小文字英数とハイフンのみ。例: ${selectorId}-picks）: `,
      )
    )
      .trim()
      .toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      console.log(
        "  ※ 半角小文字の英数とハイフンだけで入力してください（日本語は使えません）",
      );
    }
  }

  const description = await askRequired("  要約（120字程度）");

  // --- 5冊 ---
  console.log(
    "\n■ 書籍を5冊登録します。\n" +
      "  ISBN13（ハイフンありでも可）を入力すると書誌を自動取得します。\n" +
      "  取得した値はそのままでは使えないことがあるので、必ず確認してください。\n",
  );

  const books = [];
  for (let i = 1; i <= 5; i++) {
    console.log(`\n── ${i}冊目 ──`);
    let isbn = "";
    while (!/^\d{13}$/.test(isbn)) {
      isbn = (await ask("  ISBN13: ")).replace(/[^\d]/g, "");
      if (!/^\d{13}$/.test(isbn))
        console.log("  ※ 13桁の数字で入力してください");
    }

    process.stdout.write("  照会中… ");
    const info = await fetchBook(isbn);

    if (!info.found) {
      console.log("該当なし（手入力になります）");
    } else {
      console.log(`取得（${info.sources.join(" + ")}）`);
      if (info.raw.openbd && info.raw.googlebooks) {
        const o = info.raw.openbd;
        const g = info.raw.googlebooks;
        if (o.title !== g.title) {
          console.log(
            `    書名の候補: openBD「${o.title}」/ Google「${g.title}」`,
          );
        }
        if (o.volume)
          console.log(`    openBDのvolume: 「${o.volume}」（混入注意）`);
      }
    }

    console.log("  取得した値を確認してください（Enterでそのまま採用）");
    const bookTitle = await askRequired("    書名", info.title ?? "");
    const author = await askRequired("    著者", info.author ?? "");
    const translator = (
      await ask(
        `    訳者（任意）${info.translator ? `（現在: ${info.translator}）` : ""}: `,
      )
    ).trim();
    const publisher = await askRequired("    出版社", info.publisher ?? "");
    const yearInput = await askRequired("    刊行年", String(info.year ?? ""));

    console.log(
      "\n    選書理由（300〜600字）。改行を含められます。\n" +
        "    入力後、単独行に . を入れて終了してください。",
    );
    const reason = await readMultiline();

    console.log(
      "\n    この本が知られていない理由（150〜300字）。\n" +
        "    ※ このメディアの核です。絶版・専門書として刊行された・訳が古い など。\n" +
        "    入力後、単独行に . を入れて終了してください。",
    );
    const whyUnknown = await readMultiline();

    books.push({
      title: bookTitle,
      author,
      translator: translator || (info.translator ?? ""),
      publisher,
      year: Number(yearInput),
      isbn,
      reason,
      whyUnknown,
    });
  }

  // --- 書き出し ---
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "---",
    `title: ${yamlString(title)}`,
    ...(seoTitle ? [`seoTitle: ${yamlString(seoTitle)}`] : []),
    `slug: ${yamlString(slug)}`,
    `publishedAt: ${today}`,
    `description: ${yamlString(description)}`,
    `topic: ${yamlString(topic)}`,
    `selector: ${yamlString(selectorId)}`,
    "books:",
  ];

  for (const b of books) {
    lines.push(`  - title: ${yamlString(b.title)}`);
    lines.push(`    author: ${yamlString(b.author)}`);
    if (b.translator) lines.push(`    translator: ${yamlString(b.translator)}`);
    lines.push(`    publisher: ${yamlString(b.publisher)}`);
    lines.push(`    year: ${b.year}`);
    lines.push(`    isbn: ${yamlString(b.isbn)}`);
    lines.push(`    reason: ${block(b.reason, 6)}`);
    lines.push(`    whyUnknown: ${block(b.whyUnknown, 6)}`);
  }

  lines.push("---");
  lines.push("");
  lines.push(
    "<!-- 導入文をここに書く。選者がどういう人で、この5冊で何が見えるのか。3〜5段落 -->",
  );
  lines.push("");
  lines.push("<!-- まとめもここに書く -->");
  lines.push("");

  const filePath = path.join(ARTICLES_DIR, `${slug}.md`);
  if (fs.existsSync(filePath)) {
    const overwrite = (
      await ask(`\n${filePath} は既にあります。上書きしますか？ (y/N): `)
    )
      .trim()
      .toLowerCase();
    if (overwrite !== "y") {
      console.log("中止しました。");
      closeInput();
      return;
    }
  }

  fs.writeFileSync(filePath, lines.join("\n"));

  console.log(`\n✓ ${path.relative(ROOT, filePath)} を作成しました。\n`);
  console.log("次にやること:");
  console.log("  1. ファイルを開いて導入文とまとめを書く");
  console.log(
    "  2. npm run build  ← ここで5冊固定・ISBN形式・必須項目が検証される",
  );
  console.log("  3. 書影を出したい本があれば public/covers/<ISBN>.jpg に置く");
  console.log("     （出版社の許諾が必要。public/covers/README.md 参照）\n");

  closeInput();
}

/** 単独行の "." で終わる複数行入力 */
async function readMultiline() {
  const lines = [];
  while (true) {
    const line = await ask("    > ");
    if (line.trim() === ".") break;
    lines.push(line);
  }
  return lines.join("\n").trim();
}

main().catch((err) => {
  console.error("\nエラー:", err.message);
  closeInput();
  process.exit(1);
});
