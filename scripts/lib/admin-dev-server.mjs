/**
 * 記事投稿アプリ（/admin）の裏側。**開発サーバーにだけ生える口。**
 *
 *   POST /api/isbn.json          ISBNから書誌と書影を引く
 *   POST /api/articles.json      記事の一覧
 *   POST /api/article.json       記事を1本読む（編集するため）
 *   POST /api/save-article.json  記事ファイルを書き出す（新規・上書きの両方）
 *   POST /api/upload-cover.json  自前の書影を public/covers/ に置く
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
 *
 * ## 書影は src/lib/cover.ts に解決させる（再実装しない）
 * このファイルは `.mjs` なので TypeScript の `cover.ts` をそのままは読めない。
 * だが**解決順を書き写すと、本番の表示と /admin の表示が食い違う**。
 * 「取れなかった」と画面が言うので画像を置いたのに、ビルドでは openBD から取れていた
 * （あるいはその逆）という状態は、画面を見ても気づけない。
 * `article-file.mjs` を CLI と /admin で共有しているのと同じ理由で、ここも1つにする。
 *
 * 手段は Vite 開発サーバーの `ssrLoadModule`。**この口は dev にしか生えない**ので、
 * TypeScript の変換器はいつでも手元にある。読み込みは Vite 側でキャッシュされ、
 * `cover.ts` を編集すれば無効化される（だから毎回呼んでよい）。
 * 失うのは、`resolveCover` のプロセス内メモ化が Astro 側とは別インスタンスになること。
 * 外部APIを1ISBNにつき2回まで引く可能性はあるが、**自前画像の判定はメモ化の外**なので
 * 「置いたのに反映されない」は起きない。
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
import { lookupAndRemember } from "./cover-lookup.mjs";

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

/* ------------------------------------------------------------------ *
 * 書影
 * ------------------------------------------------------------------ */

/** `src/lib/cover.ts` を dev サーバーの変換器ごしに読む（上のコメントの理由） */
function loadCoverModule(server) {
  return server.ssrLoadModule("/src/lib/cover.ts");
}

const COVERS_DIR = path.join(ROOT, "public/covers");

/** 画像の実体を先頭バイトで判定する。拡張子は自己申告なので信用しない */
function sniffImage(buf) {
  if (
    buf.length >= 3 &&
    buf[0] === 0xff &&
    buf[1] === 0xd8 &&
    buf[2] === 0xff
  ) {
    return "jpeg";
  }
  if (
    buf.length >= 8 &&
    buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a"
  ) {
    return "png";
  }
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString("ascii") === "RIFF" &&
    buf.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

/** 拡張子 → 期待する実体。`.jpg` と `.jpeg` は同じ形式 */
const EXTENSION_FORMAT = {
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".png": "png",
  ".webp": "webp",
};

/**
 * 画像ファイルの上限。書影は大きくても数百KBで、これを超えるものは
 * ほぼ確実に間違ったファイル（スキャン画像・PDF由来など）。
 * ここは base64 で受けるので、JSON本体はこの4/3倍まで膨らむ。
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * 自前の書影を `public/covers/<ISBN>.<ext>` に置く。
 *
 * **画像は変換もリサイズもせず、渡されたまま書く。** 書影は権利者の表紙デザインで、
 * こちらで加工した版を配信する筋合いのものではない。
 *
 * 受け渡しは base64（既存の口と同じく POST・JSON）。multipart にすると
 * このミドルウェアにパーサを1つ抱えることになるが、置くのは1回1ファイル・数百KBで、
 * base64 の3割増しを気にする場面ではない。
 */
async function uploadCover(server, body) {
  const { LOCAL_EXTENSIONS } = await loadCoverModule(server);

  const isbn = String(body.isbn ?? "").replace(/[^\d]/g, "");
  if (!/^\d{13}$/.test(isbn)) {
    return { status: 400, body: { error: "ISBN13を指定してください" } };
  }

  // 拡張子の許可リストは cover.ts の LOCAL_EXTENSIONS そのもの。
  // ここに書き写すと、片方だけ増えたときに「置けるのに表示されない」が起きる
  const ext = String(body.filename ?? "")
    .toLowerCase()
    .match(/\.[a-z0-9]+$/)?.[0];
  if (!ext || !LOCAL_EXTENSIONS.includes(ext)) {
    return {
      status: 400,
      body: { error: `拡張子は ${LOCAL_EXTENSIONS.join(" / ")} のみです` },
    };
  }

  let buf;
  try {
    buf = Buffer.from(String(body.data ?? ""), "base64");
  } catch {
    buf = Buffer.alloc(0);
  }
  if (buf.length === 0) {
    return { status: 400, body: { error: "ファイルが空です" } };
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    return {
      status: 400,
      body: {
        error: `ファイルが大きすぎます（${Math.round(buf.length / 1024)}KB / 上限 ${MAX_IMAGE_BYTES / 1024 / 1024}MB）`,
      },
    };
  }

  // 拡張子を偽ったファイルを置くと、壊れた書影がそのまま本番に出る。
  // 表示が壊れてから原因をたどるのは高くつくので、置く前に実体で確かめる
  const actual = sniffImage(buf);
  if (!actual) {
    return { status: 400, body: { error: "画像ファイルではありません" } };
  }
  if (actual !== EXTENSION_FORMAT[ext]) {
    return {
      status: 400,
      body: { error: `中身は ${actual} です。${ext} ではありません` },
    };
  }

  // 同じISBNで拡張子違いのファイルが残ると、LOCAL_EXTENSIONS の順で先勝ちになり、
  // **いま置いたはずの画像が出ない**。これは画面を見ても原因が分からない事故なので、
  // 確認のうえで「1つのISBNには1つのファイル」に揃える（残す方を選ばせはしない）
  const existing = LOCAL_EXTENSIONS.map((e) => `${isbn}${e}`).filter((name) =>
    fs.existsSync(path.join(COVERS_DIR, name)),
  );
  if (existing.length > 0 && !body.overwrite) {
    return { status: 409, body: { exists: true, isbn, files: existing } };
  }

  fs.mkdirSync(COVERS_DIR, { recursive: true });
  const filename = `${isbn}${ext}`;
  fs.writeFileSync(path.join(COVERS_DIR, filename), buf);
  const replaced = existing.filter((name) => name !== filename);
  for (const name of replaced) {
    fs.rmSync(path.join(COVERS_DIR, name));
  }

  return {
    status: 200,
    body: {
      ok: true,
      isbn,
      path: `public/covers/${filename}`,
      replaced,
      // 置いた直後の解決結果をそのまま返す。画面が自前でURLを組み立てると、
      // 「置けたのに表示されない」を画面側が隠してしまう
      cover: await resolveCoverFor(server, isbn),
    },
  };
}

/**
 * 書影を解決する。**ここが「登録の瞬間」にあたる。**
 *
 * まず `lookupAndRemember` で外部APIを引き、結果を `src/data/covers.json` に記録する。
 * ビルドと dev の表示はこの記録を読むだけなので、**引くのはここだけ**でよい。
 * 表示のたびに引いていた頃は、Google Books の1日あたりの上限を使い切ると
 * 書影が一斉に消えていた。
 *
 * 記録したあと `cover.ts` に解決させ直すのは、**画面に出る答えと
 * ビルドで出る答えを必ず一致させる**ため（自前画像の優先も含めて）。
 */
async function resolveCoverFor(server, isbn) {
  try {
    await lookupAndRemember(isbn);
    const { resolveCover } = await loadCoverModule(server);
    return await resolveCover(isbn);
  } catch (err) {
    // 書影が引けなくても書誌の入力は続けられる。画面には「分からない」と出す
    return {
      url: null,
      source: "fallback",
      error: String(err?.message ?? err),
    };
  }
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
            // 書誌が引けない本でも書影は取れることがある（逆もある）。
            // 片方の失敗でもう片方を落とさない
            const [biblio, cover] = await Promise.all([
              lookupIsbn(isbn),
              resolveCoverFor(server, isbn),
            ]);
            return send(200, { ...biblio, isbn, cover });
          }

          if (url === "/api/upload-cover.json") {
            const { status, body: out } = await uploadCover(server, body);
            return send(status, out);
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
