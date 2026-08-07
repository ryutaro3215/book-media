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
import YAML from "yaml";

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
 * frontmatter + 本文を組み立てて文字列を返す。
 *
 * 長文（description / reason / whyBuried / 本文）は、渡されなければ
 * `TODO:` のまま出す。`draft: true` のあいだは `TODO:` が残っていても
 * ビルドが通るので、途中の状態でも保存できる。
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
    updatedAt,
    /** frontmatter の外の Markdown。導入文とまとめはここに一続きで書く */
    body,
    /** 既存記事を編集して保存するときは、draft の値を保つ */
    draft = true,
  } = data;

  const lines = [
    "---",
    `title: ${yamlString(title)}`,
    ...(seoTitle ? [`seoTitle: ${yamlString(seoTitle)}`] : []),
    `slug: ${yamlString(slug)}`,
    "# 書き上がったら false にする。そこで初めて未記入（TODO:）が検出される",
    `draft: ${draft}`,
    `publishedAt: ${publishedAt}`,
    ...(updatedAt ? [`updatedAt: ${updatedAt}`] : []),
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

  // 本文が渡されていればそれを、無ければ何を書く場所かの案内を置く
  if (body?.trim()) {
    lines.push(body.trim());
  } else {
    lines.push(
      `<!-- 導入文をここに書く。選者がどういう人で、この${books.length}冊で何が見えるのか。3〜5段落 -->`,
    );
    lines.push("");
    lines.push("<!-- まとめもここに書く -->");
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * 既存記事を読む。**編集して保存し直すために使う。**
 *
 * `mtimeMs` を一緒に返すのが要点。保存するときにこの値と突き合わせて、
 * **読み込んだあとにファイルが外で変わっていたら気づけるようにする**
 * （ビルドが落ちてエディタで直した / git pull した、など）。
 * 失うのが原稿そのものなので、黙って上書きさせない。
 */
export function readArticle(slug) {
  const filePath = path.join(ARTICLES_DIR, `${slug}.md`);
  const raw = fs.readFileSync(filePath, "utf8");

  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error(`${slug}.md の frontmatter を読めません`);

  return {
    // 日付は yaml が文字列のまま返す（Date にすると保存時に表記が変わる）
    data: YAML.parse(m[1]) ?? {},
    body: m[2] ?? "",
    mtimeMs: fs.statSync(filePath).mtimeMs,
  };
}

/**
 * 記事の一覧。編集する記事を選ぶために使う。
 *
 * **下書きは「最後に触った順」、公開済みは「公開日の降順」**で返す。
 * 書きかけを探すときに効くのは更新の新しさで、公開済みを探すときは
 * いつ出した記事かで思い出す。並べ方が違うのは、探し方が違うため。
 */
export function listArticles() {
  if (!fs.existsSync(ARTICLES_DIR)) return [];
  const items = fs
    .readdirSync(ARTICLES_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const slug = f.replace(/\.md$/, "");
      try {
        const { data, mtimeMs } = readArticle(slug);
        return {
          slug: data.slug ?? slug,
          file: slug,
          title: data.title ?? slug,
          draft: data.draft !== false,
          publishedAt: String(data.publishedAt ?? ""),
          topic: data.topic ?? "",
          subtopic: data.subtopic ?? "",
          tags: Array.isArray(data.tags) ? data.tags : [],
          selector: data.selector ?? "",
          books: Array.isArray(data.books) ? data.books.length : 0,
          mtimeMs,
        };
      } catch {
        // 壊れた記事があっても一覧そのものは出す
        return {
          slug,
          file: slug,
          title: `（読めません）${slug}`,
          draft: true,
          broken: true,
          mtimeMs: 0,
        };
      }
    });

  return items.sort((a, b) => {
    if (a.draft !== b.draft) return a.draft ? -1 : 1; // 下書きを先に
    if (a.draft) return (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0);
    return String(b.publishedAt).localeCompare(String(a.publishedAt));
  });
}

/** 読み込んだあとに外でファイルが変わっていないか */
export function isStale(slug, knownMtimeMs) {
  const filePath = path.join(ARTICLES_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return false;
  // 保存のたびに mtime は変わる。1ms 単位の比較だと誤検知するので少し緩める
  return fs.statSync(filePath).mtimeMs - Number(knownMtimeMs ?? 0) > 1;
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
