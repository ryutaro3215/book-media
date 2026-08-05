#!/usr/bin/env node
/**
 * 記事の雛形を作る対話式スクリプト。
 *
 *   npm run new:article
 *
 * ## 何をするか
 *   1. テーマを既存の語彙から選ばせる（新規は明示的に追加させる）
 *   2. 選者をマスタから選ばせる（新規はその場で登録できる）
 *   3. 冊数（3冊以上）を聞き、その冊数ぶん ISBN13 を入力させ、
 *      **openBD と Google Books から書誌を自動取得**する
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
const TAGS_PATH = path.join(ROOT, "src/data/tags.json");
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
 * 実測にもとづく項目ごとの優先順位（plan.md T21）:
 *
 *   書名   **Google Books** → openBD
 *          openBD は叢書名・巻次・副題が書名に混ざる。1本目の記事で実際に
 *          「共立講座数学の魅力. 11」（叢書名）が入り、正しい
 *          「現代数理統計学の基礎」は Google Books 側が返していた
 *   著者   Google Books（表示用の形）→ openBD（整形後）
 *          openBD は `Locke,John,1632-1704` のような図書館形式で返る
 *   出版社 **openBD のみ**。Google Books は返さない（実測 0/10）
 *   刊行年 openBD → Google Books。食い違う場合は要確認コメントに出す
 */
async function fetchBook(isbn) {
  const [o, g] = await Promise.all([fetchOpenBd(isbn), fetchGoogleBooks(isbn)]);
  if (!o && !g) return { found: false, sources: [] };

  const sources = [o && "openBD", g && "GoogleBooks"].filter(Boolean);
  return {
    found: true,
    sources,
    title: g?.title || o?.title || "",
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

  const selectors = readJson(SELECTORS_PATH);

  // --- 大トピック ---
  // 語彙は docs/topics-list.md 由来（学問分類）。ページが生成されるのはここだけ
  const topics = readJson(TOPICS_PATH);
  const topicNames = Object.keys(topics);

  const topicChoice = await chooseFromList(
    "■ 大トピックを選んでください",
    topicNames.map((t) => ({ label: t, value: t })),
    { allowNew: true },
  );

  let topic;
  if (topicChoice.isNew) {
    console.log(
      "\n  新しい大トピックを追加します。\n" +
        "  ※ 大トピックは学問の大分類です（数学 / 経営学 など）。\n" +
        "    細かい分野は小トピックかタグに入れてください。",
    );
    topic = await askRequired("  大トピック名");
    topics[topic] = { description: "", subtopics: [] };
    writeJson(TOPICS_PATH, topics);
    console.log(`  → src/data/topics.json に「${topic}」を追加しました`);
  } else {
    topic = topicChoice.value;
  }

  // --- 小トピック（任意・1つ） ---
  // 全体で919件あるため一覧は出さず、大トピック配下だけを見せる
  const subtopics = topics[topic]?.subtopics ?? [];
  let subtopic = "";

  if (subtopics.length > 0) {
    console.log(`\n■ 小トピック（任意）— 「${topic}」の中の分野`);
    for (const [i, name] of subtopics.entries()) {
      console.log(`  ${String(i + 1).padStart(3)}. ${name}`);
    }
    console.log("  n. 新しく追加する  ／  Enter で指定しない");

    const answer = (await ask("  番号: ")).trim();
    if (answer.toLowerCase() === "n") {
      subtopic = await askRequired("  小トピック名");
      topics[topic].subtopics = [...subtopics, subtopic].sort();
      writeJson(TOPICS_PATH, topics);
      console.log(`  → 「${topic}」に「${subtopic}」を追加しました`);
    } else if (answer) {
      const idx = Number(answer) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < subtopics.length) {
        subtopic = subtopics[idx];
      }
    }
  }

  // --- タグ（任意・複数） ---
  // 423件あるので一覧は出さず、入力した語で絞り込む
  const tags = readJson(TAGS_PATH);
  const allTags = Object.keys(tags);
  const chosenTags = [];

  console.log(
    "\n■ タグ（任意・複数）— 小トピックより細かいもの\n" +
      "  語を入力すると候補を絞り込みます。Enter だけで終了。\n" +
      "  候補に無い語はそのまま新しいタグとして登録されます。",
  );

  while (true) {
    const query = (await ask("  検索/入力（空でEnter終了）: ")).trim();
    if (!query) break;

    const hits = allTags.filter((name) => name.includes(query));
    if (hits.length === 0) {
      tags[query] = {};
      writeJson(TAGS_PATH, tags);
      allTags.push(query);
      chosenTags.push(query);
      console.log(`  → 新しいタグ「${query}」を追加しました`);
      continue;
    }

    if (hits.length === 1) {
      chosenTags.push(hits[0]);
      console.log(`  → 「${hits[0]}」を追加`);
      continue;
    }

    for (const [i, name] of hits.slice(0, 20).entries()) {
      console.log(`    ${i + 1}. ${name}`);
    }
    const pick = (await ask("    番号（新規登録するなら n）: ")).trim();
    if (pick.toLowerCase() === "n") {
      tags[query] = {};
      writeJson(TAGS_PATH, tags);
      allTags.push(query);
      chosenTags.push(query);
      console.log(`  → 新しいタグ「${query}」を追加しました`);
    } else {
      const idx = Number(pick) - 1;
      if (Number.isInteger(idx) && idx >= 0 && idx < hits.length) {
        chosenTags.push(hits[idx]);
        console.log(`  → 「${hits[idx]}」を追加`);
      }
    }
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

  // 冊数を先に聞く。タイトルの雛形にもISBNの入力回数にも使うため。
  // 以前は5冊固定だった（.dev/business-plan.md 2026-08-05 の判断で3冊以上に変更）
  let bookCount = 0;
  while (!Number.isInteger(bookCount) || bookCount < 3) {
    const raw = (await ask("\n  紹介する冊数（3以上・Enterで5）: ")).trim();
    bookCount = raw === "" ? 5 : Number(raw);
    if (!Number.isInteger(bookCount) || bookCount < 3) {
      console.log("  ※ 3以上の整数で入力してください");
    }
  }

  // タイトルは自動生成しない。雛形は出すが、選ぶか自分で書くかは毎回決めてもらう。
  // タイトルは記事ごとに考える価値のある要素で、型に流し込むと全記事が同じ顔になる
  console.log("\n  記事タイトル");
  const titleChoice = await chooseFromList(
    "  雛形から選ぶか、自由に入力してください",
    [
      {
        label: `${selectorName}が選ぶ、${topic}の${bookCount}冊`,
        value: `${selectorName}が選ぶ、${topic}の${bookCount}冊`,
      },
      {
        label: `${topic}を知るための${bookCount}冊 — ${selectorName}が選ぶ`,
        value: `${topic}を知るための${bookCount}冊 — ${selectorName}が選ぶ`,
      },
      {
        label: `${selectorName}が薦める、${topic}の隠れた${bookCount}冊`,
        value: `${selectorName}が薦める、${topic}の隠れた${bookCount}冊`,
      },
    ],
    { allowNew: true, newLabel: "自由に入力する" },
  );
  const title = titleChoice.isNew
    ? await askRequired("  タイトル")
    : titleChoice.value;

  // 検索用タイトル（任意）。
  // 記事タイトルは「〈選者〉が選ぶ、〈テーマ〉のN冊」の型で、X共有時に
  // 「誰が選んだか」を伝えるための形。一方で検索する人は
  // 「〇〇 入門書」「〇〇 おすすめ 本」と打つため、語が噛み合わない。
  // 両立させるために、<title> だけ差し替えられるようにしてある。
  console.log(
    "\n  検索用タイトル（任意・Enterでスキップ）\n" +
      "  検索結果に出る <title> だけを差し替えます。上のタイトルはそのまま残ります。\n" +
      `  例: ${topic}の入門書${bookCount}冊 — ${selectorName}が選ぶ`,
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

  // --- 書籍 ---
  console.log(
    `\n■ 書籍を${bookCount}冊登録します。ISBN13 を順に入れてください（ハイフン可）。\n` +
      "  書誌は自動取得し、確認と選書理由は生成後のファイルで書きます。\n",
  );

  const books = [];
  const warnings = [];

  for (let i = 1; i <= bookCount; i++) {
    let isbn = "";
    while (!/^\d{13}$/.test(isbn)) {
      isbn = (await ask(`  ${i}冊目のISBN13: `)).replace(/[^\d]/g, "");
      if (!/^\d{13}$/.test(isbn)) {
        console.log("  ※ 13桁の数字で入力してください");
      }
    }

    process.stdout.write("      照会中… ");
    const info = await fetchBook(isbn);

    if (!info.found) {
      console.log("該当なし → 書誌は手入力になります");
      warnings.push(`${i}冊目（${isbn}）: 書誌が取得できなかったので手で書く`);
    } else {
      console.log(`${info.title}（${info.publisher}・${info.year}）`);

      // 機械では正解を選べない箇所を、ファイル冒頭に残して後で確認できるようにする
      const o = info.raw.openbd;
      const g = info.raw.googlebooks;
      if (o && g && o.title !== g.title) {
        warnings.push(
          `${i}冊目: 書名の候補が2つ — openBD「${o.title}」/ Google「${g.title}」`,
        );
      }
      if (o?.volume) {
        warnings.push(
          `${i}冊目: openBD の volume「${o.volume}」が書名に混ざっている可能性`,
        );
      }
      if (o && g && o.year && g.year && o.year !== g.year) {
        warnings.push(
          `${i}冊目: 刊行年が食い違う — openBD ${o.year} / Google ${g.year}`,
        );
      }
      if (!info.publisher) {
        warnings.push(`${i}冊目: 出版社が取得できなかった`);
      }
    }

    books.push({
      title: info.title || "TODO: 書名",
      author: info.author || "TODO: 著者",
      translator: info.translator || "",
      publisher: info.publisher || "TODO: 出版社",
      year: info.year || 0,
      isbn,
      reason: "TODO: この本を薦める理由を300〜600字で書く",
    });
  }

  // --- 知る人ぞ知る本（任意） ---
  // 全冊に「知られていない理由」を必須にすると書ける記事が狭まりすぎるため、
  // **1冊だけ・任意**にしてある。印が付いた本は /hidden に集まる
  console.log(
    "\n■ 知る人ぞ知る本（任意・Enterでスキップ）\n" +
      "  この中で「いちばん知られていない」と思う本があれば、番号を選んでください。\n" +
      "  選ぶと /hidden（分野を横断した一覧）に載ります。判定は主観で構いません。",
  );
  for (const [i, b] of books.entries()) {
    console.log(`  ${i + 1}. ${b.title}`);
  }

  const buriedAnswer = (await ask("  番号（無ければEnter）: ")).trim();
  const buriedIndex = Number(buriedAnswer) - 1;
  if (
    Number.isInteger(buriedIndex) &&
    buriedIndex >= 0 &&
    buriedIndex < books.length
  ) {
    console.log(
      `\n  「${books[buriedIndex].title}」がなぜ知られていないのかを書きます。\n` +
        "  絶版・専門書として刊行された・訳が古い・分野をまたぐので棚に置かれにくい など。\n" +
        "  ここは生成後のファイルで書いても構いません（TODO: のまま出力されます）。",
    );
    books[buriedIndex].whyBuried =
      "TODO: この本がなぜ知られていないのかを150〜300字で書く";
  }

  // --- 書き出し ---
  const today = new Date().toISOString().slice(0, 10);
  const lines = [
    "---",
    `title: ${yamlString(title)}`,
    ...(seoTitle ? [`seoTitle: ${yamlString(seoTitle)}`] : []),
    `slug: ${yamlString(slug)}`,
    "# 書き上がったら false にする。そこで初めて未記入（TODO:）が検出される",
    "draft: true",
    `publishedAt: ${today}`,
    `description: ${yamlString(description)}`,
    `topic: ${yamlString(topic)}`,
    ...(subtopic ? [`subtopic: ${yamlString(subtopic)}`] : []),
    ...(chosenTags.length > 0
      ? ["tags:", ...chosenTags.map((tag) => `  - ${yamlString(tag)}`)]
      : []),
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
    if (b.whyBuried) {
      lines.push(`    whyBuried: ${block(b.whyBuried, 6)}`);
    }
  }

  lines.push("---");
  lines.push("");
  if (warnings.length > 0) {
    lines.push("<!--");
    lines.push("  要確認（自動取得で判断できなかった箇所）:");
    for (const w of warnings) lines.push(`    - ${w}`);
    lines.push("  確認して直したら、このコメントは消してよい");
    lines.push("-->");
    lines.push("");
  }
  lines.push(
    `<!-- 導入文をここに書く。選者がどういう人で、この${books.length}冊で何が見えるのか。3〜5段落 -->`,
  );
  lines.push("");
  lines.push("<!-- まとめもここに書く -->");
  lines.push("");

  // 記事を全部消すとディレクトリごと無くなるので、書く前に作る
  fs.mkdirSync(ARTICLES_DIR, { recursive: true });

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
  if (warnings.length > 0) {
    console.log("要確認（ファイル冒頭のコメントにも書いてあります）:");
    for (const w of warnings) console.log(`  - ${w}`);
    console.log("");
  }
  console.log("次にやること:");
  console.log(
    "  1. ファイルをエディタで開き、書誌の確認・選書理由・導入文を書く",
  );
  console.log(
    "     TODO: の箇所がすべて対象。draft: true のあいだはビルドが通る",
  );
  console.log("  2. npm run dev で見た目を確認する（下書きも表示される）");
  console.log("  3. 書き上がったら draft: false にする");
  console.log("     → npm run build で未記入が残っていないか検証される");
  console.log("  4. 書影を出したい本があれば public/covers/<ISBN>.jpg に置く");
  console.log("     （出版社の許諾が必要。docs/covers.md 参照）\n");

  closeInput();
}

main().catch((err) => {
  console.error("\nエラー:", err.message);
  closeInput();
  process.exit(1);
});
