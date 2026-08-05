/**
 * 記事Markdownの組み立て。
 *
 * **CLI（scripts/new-article.mjs）と投稿アプリ（/admin）の両方から使う。**
 * 別々に実装すると、同じ記事なのに引用符の付き方や下書きコメントの有無が
 * 食い違ったファイルが混ざる。出力を1箇所に持たせて、その分岐を無くしてある。
 *
 * TypeScript ではなく .mjs なのは、Node から直接動かす CLI が主たる利用者のため。
 * Astro 側からは Vite がそのまま解決する。
 */
import fs from "node:fs";
import path from "node:path";

export const ARTICLES_DIR = path.join(process.cwd(), "src/content/interviews");

/**
 * YAMLの文字列として安全に出す。
 * 書名には `：` や `"` が普通に入るので、常に二重引用符で囲んでエスケープする。
 */
export function yamlString(value) {
  return JSON.stringify(String(value ?? ""));
}

/**
 * 複数行になりうる本文をブロックスカラー（`|-`）で出す。
 * 選書理由は300〜600字あり、1行に押し込むと編集できなくなる。
 */
export function block(text, indent) {
  const pad = " ".repeat(indent);
  const body = String(text ?? "")
    .split("\n")
    .map((line) => (line ? pad + line : ""))
    .join("\n");
  return `|-\n${body}`;
}

/** slug が URL として使える形か（content.config.ts の regex と揃える） */
export function isValidSlug(slug) {
  return /^[a-z0-9][a-z0-9-]*$/.test(slug);
}

/**
 * frontmatter + 本文の雛形を組み立てて文字列を返す。
 *
 * 長文（description / reason / whyBuried / 導入文）は `TODO:` のまま出す。
 * ターミナルでもブラウザのフォームでも長文は書きにくく、書き直しはもっと辛い。
 * **エディタで書くのが一番速い**ので、ここでは枠だけ作る。
 */
export function buildArticle(data) {
  const {
    title,
    seoTitle,
    slug,
    description,
    topic,
    subtopic,
    tags = [],
    selector,
    books,
    warnings = [],
    publishedAt = new Date().toISOString().slice(0, 10),
  } = data;

  const lines = [
    "---",
    `title: ${yamlString(title)}`,
    ...(seoTitle ? [`seoTitle: ${yamlString(seoTitle)}`] : []),
    `slug: ${yamlString(slug)}`,
    "# 書き上がったら false にする。そこで初めて未記入（TODO:）が検出される",
    "draft: true",
    `publishedAt: ${publishedAt}`,
    `description: ${yamlString(description || "TODO: 検索結果に出る100〜120字の説明")}`,
    `topic: ${yamlString(topic)}`,
    ...(subtopic ? [`subtopic: ${yamlString(subtopic)}`] : []),
    ...(tags.length > 0
      ? ["tags:", ...tags.map((tag) => `  - ${yamlString(tag)}`)]
      : []),
    `selector: ${yamlString(selector)}`,
    "books:",
  ];

  for (const b of books) {
    lines.push(`  - title: ${yamlString(b.title || "TODO: 書名")}`);
    lines.push(`    author: ${yamlString(b.author || "TODO: 著者")}`);
    if (b.translator) lines.push(`    translator: ${yamlString(b.translator)}`);
    lines.push(`    publisher: ${yamlString(b.publisher || "TODO: 出版社")}`);
    lines.push(`    year: ${Number(b.year) || new Date().getFullYear()}`);
    lines.push(`    isbn: ${yamlString(b.isbn)}`);
    lines.push(
      `    reason: ${block(b.reason || "TODO: この本を薦める理由を300〜600字で書く", 6)}`,
    );
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

  return lines.join("\n");
}

/**
 * 記事を書き出してパスを返す。
 * 記事を全部消すとディレクトリごと git から消えるので、書く前に必ず作る。
 */
export function writeArticle(slug, contents) {
  fs.mkdirSync(ARTICLES_DIR, { recursive: true });
  const filePath = path.join(ARTICLES_DIR, `${slug}.md`);
  fs.writeFileSync(filePath, contents);
  return filePath;
}

export function articleExists(slug) {
  return fs.existsSync(path.join(ARTICLES_DIR, `${slug}.md`));
}
