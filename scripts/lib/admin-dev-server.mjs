/**
 * 記事投稿アプリ（/admin）の裏側。**開発サーバーにだけ生える口。**
 *
 *   POST /api/isbn.json          ISBNから書誌を引く
 *   POST /api/articles.json      記事の一覧
 *   POST /api/article.json       記事を1本読む（編集するため）
 *   POST /api/save-article.json  記事ファイルを書き出す（新規・上書きの両方）
 *
 * ## なぜ Astro の API ルートではなく Vite のミドルウェアなのか
 * このサイトは静的出力なので、`src/pages/api/` に置いたルートは
 * **事前生成の対象**になる。その結果、開発サーバーでも実リクエストとしては
 * 扱われず、クエリもボディも handler に届かなかった（実測）。
 * `prerender = false` にするとアダプタが必要になり、本番構成が変わってしまう。
 *
 * Vite プラグインの `apply: "serve"` なら、**ビルドでは読み込まれもしない**。
 * 「本番に出さない」がビルド後に消す運用ではなく、構造で保証される。
 *
 * ## 書誌の取得方針
 * 実測にもとづく（.dev/build-log.md T21）:
 *   書名・著者 → Google Books（openBD は叢書名・巻次・図書館形式が混ざる）
 *   出版社     → openBD（Google Books は返さない）
 * 自動取得はあくまで下書き。食い違いは warnings に出して**人が現物で確かめる**。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  articleExists,
  buildArticle,
  isStale,
  isValidSlug,
  listArticles,
  readArticle,
  writeArticle,
} from "./article-file.mjs";

const TIMEOUT_MS = 8000;
const ROOT = process.cwd();

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
}

function parseYear(value) {
  const m = typeof value === "string" ? value.match(/(\d{4})/) : null;
  return m ? Number(m[1]) : undefined;
}

/** openBD の著者は「Locke,John,1632-1704／田中太郎 著」のような図書館形式 */
function cleanOpenBdAuthor(raw) {
  if (!raw) return "";
  return raw
    .split(/[／/]/)[0]
    .replace(/,\s*\d{4}-(?:\d{4})?/g, "")
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
    const authors = v.authors ?? [];
    return {
      title: String(v.title).trim(),
      author: authors[0] ?? "",
      translator: authors[1] ?? "",
      publisher: String(v.publisher ?? "").trim(),
      year: parseYear(v.publishedDate),
    };
  } catch {
    return null;
  }
}

async function lookupIsbn(isbn) {
  const [o, g] = await Promise.all([fetchOpenBd(isbn), fetchGoogleBooks(isbn)]);
  if (!o && !g) {
    return { found: false, warnings: ["書誌が取得できませんでした"] };
  }

  const warnings = [];
  if (o && g && o.title !== g.title) {
    warnings.push(
      `書名の候補が2つ — openBD「${o.title}」/ Google「${g.title}」`,
    );
  }
  if (o?.volume) warnings.push(`openBD の巻次「${o.volume}」が混ざる可能性`);
  if (o?.year && g?.year && o.year !== g.year) {
    warnings.push(`刊行年が食い違う — openBD ${o.year} / Google ${g.year}`);
  }
  if (!o?.publisher) warnings.push("出版社が取得できませんでした");

  return {
    found: true,
    isbn,
    title: g?.title || o?.title || "",
    author: g?.author || o?.author || "",
    translator: g?.translator || "",
    publisher: o?.publisher || g?.publisher || "",
    year: o?.year ?? g?.year ?? "",
    warnings,
  };
}

/**
 * 保存前の検証。
 * ブラウザ側でも同じことを見ているが、**ファイルを書く直前がここ**。
 * 通してしまうとビルドが落ちる記事ができ、原因が分かりにくくなる。
 */
function validate(data) {
  const errors = [];
  const topics = readJson("src/data/topics.json");
  const tags = readJson("src/data/tags.json");
  const selectors = readJson("src/data/selectors.json");

  if (!data.title?.trim()) errors.push("タイトルが未入力です");
  if (!data.slug?.trim()) errors.push("slug が未入力です");
  else if (!isValidSlug(data.slug)) {
    errors.push("slug は半角小文字の英数とハイフンのみ（先頭はハイフン以外）");
  }

  if (!topics[data.topic]) {
    errors.push(`大トピック「${data.topic ?? ""}」は登録されていません`);
  } else if (
    data.subtopic &&
    !topics[data.topic].subtopics.includes(data.subtopic)
  ) {
    errors.push(
      `「${data.subtopic}」は大トピック「${data.topic}」の小トピックではありません`,
    );
  }

  for (const tag of data.tags ?? []) {
    if (!(tag in tags)) errors.push(`未登録のタグです: ${tag}`);
  }
  if (!selectors[data.selector]) {
    errors.push(`未登録の選者IDです: ${data.selector ?? ""}`);
  }

  const books = data.books ?? [];
  if (books.length < 3) errors.push("本は3冊以上にしてください");
  books.forEach((book, i) => {
    if (!/^\d{13}$/.test((book.isbn ?? "").trim())) {
      errors.push(`${i + 1}冊目の ISBN が13桁の数字ではありません`);
    }
  });

  return errors;
}

function saveArticle(data) {
  const errors = validate(data);
  if (errors.length > 0) return { status: 400, body: { errors } };

  const slug = data.slug.trim();
  const exists = articleExists(slug);

  // 新規のつもりで既存の slug を書こうとしている。書き上げた原稿を消しうる
  if (exists && !data.overwrite && !data.editing) {
    return { status: 409, body: { exists: true, slug } };
  }

  // 編集中に、読み込んだあとファイルが外で変わっていた。
  // ビルドが落ちてエディタで直した / git pull した、など。黙って上書きしない
  if (data.editing && isStale(slug, data.mtimeMs) && !data.force) {
    return { status: 409, body: { stale: true, slug } };
  }

  const filePath = writeArticle(
    slug,
    buildArticle({
      title: data.title.trim(),
      seoTitle: data.seoTitle?.trim() || undefined,
      slug,
      description: data.description?.trim() ?? "",
      topic: data.topic,
      subtopic: data.subtopic || undefined,
      tags: data.tags ?? [],
      selector: data.selector,
      books: (data.books ?? []).map((b) => ({
        ...b,
        isbn: (b.isbn ?? "").trim(),
      })),
      warnings: data.warnings ?? [],
      body: data.body,
      // 編集では公開状態と日付を保つ。ここを取りこぼすと
      // 公開済みの記事が下書きに戻る（実際に一度やった事故）
      draft: data.draft !== false,
      publishedAt: data.publishedAt || undefined,
      updatedAt: data.updatedAt || undefined,
    }),
  );

  return {
    status: 200,
    body: {
      ok: true,
      slug,
      path: path.relative(ROOT, filePath),
      mtimeMs: fs.statSync(filePath).mtimeMs,
    },
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/** @returns {import("vite").Plugin} */
export function adminDevServer() {
  return {
    name: "book-media:admin-dev-server",
    // 開発サーバーでのみ読み込まれる。ビルドには一切関与しない
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? "").split("?")[0];
        if (!url.startsWith("/api/")) return next();

        const send = (status, body) => {
          res.statusCode = status;
          res.setHeader("content-type", "application/json; charset=utf-8");
          res.end(JSON.stringify(body));
        };

        if (req.method !== "POST") return send(405, { error: "POST のみ" });

        try {
          const body = await readBody(req);

          if (url === "/api/isbn.json") {
            const isbn = String(body.isbn ?? "").replace(/[^\d]/g, "");
            if (!/^\d{13}$/.test(isbn)) {
              return send(400, { error: "ISBN13を指定してください" });
            }
            return send(200, await lookupIsbn(isbn));
          }

          if (url === "/api/articles.json") {
            return send(200, { articles: listArticles() });
          }

          if (url === "/api/article.json") {
            const slug = String(body.slug ?? "");
            if (!articleExists(slug)) {
              return send(404, { error: `${slug}.md がありません` });
            }
            const { data, body: md, mtimeMs } = readArticle(slug);
            return send(200, { data, body: md, mtimeMs });
          }

          if (url === "/api/save-article.json") {
            const { status, body: out } = saveArticle(body);
            return send(status, out);
          }

          return send(404, { error: "そのような口はありません" });
        } catch (err) {
          return send(500, { error: String(err?.message ?? err) });
        }
      });
    },
  };
}
