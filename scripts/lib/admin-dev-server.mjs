/**
 * 記事投稿アプリ（/admin）の裏側。**開発サーバーにだけ生える口。**
 *
 *   POST /api/isbn.json          ISBNから書誌と書影を引く
 *   POST /api/articles.json      記事の一覧
 *   POST /api/article.json       記事を1本読む（編集するため）
 *   POST /api/save-article.json  記事ファイルを書き出す（新規・上書きの両方）
 *   POST /api/upload-cover.json  自前の書影を public/covers/ に置く
 *   POST /api/selectors.json     選者マスタを丸ごと読む
 *   POST /api/save-selector.json 選者を登録・編集する
 *   POST /api/upload-avatar.json 顔写真を public/selectors/ に置く
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
import { hasLocalCover, lookupAndRemember } from "./cover-lookup.mjs";
import { loadEnv } from "./prompt.mjs";
import {
  AVATARS_DIR,
  buildSelector,
  readSelectors,
  selectorWarnings,
  validateSelector,
  writeSelectors,
} from "./selector-file.mjs";

const TIMEOUT_MS = 8000;
const ROOT = process.cwd();

/**
 * `.env` を `process.env` に読み込む。
 *
 * **`astro dev` は `.env` を `import.meta.env` にしか入れない。**
 * このファイルは Vite プラグインとして Node 側で動くので `process.env` を見るが、
 * そこには何も入っていなかった。結果、**Google Books をキー無しで叩いていた。**
 *
 * キー無しのリクエストは共有の枠を使うため、すぐ 429 が返る。
 * 画面には「1日あたりの上限の可能性」と出ていたが、実際には
 * **こちらの上限は余っていて、キーが渡っていなかっただけ**だった。
 *
 * `src/lib/cover.ts` でも同じ罠を踏んでいる（`import.meta.env` を先に見て
 * `process.env` にフォールバックする形で回避した）。
 */
loadEnv(path.join(ROOT, ".env"));

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
}

function parseYear(value) {
  const m = typeof value === "string" ? value.match(/(\d{4})/) : null;
  return m ? Number(m[1]) : undefined;
}

/**
 * openBD の著者を人が読む形に直す。
 *
 * openBD は図書館の目録形式で返す。実測した形:
 *   「Locke,John,1632-1704／田中太郎 著」   ／ 区切り
 *   「Christensen,ClaytonM 玉田,俊平太 伊豆原,弓」  全角スペース区切り・姓,名
 *   「神取,道宏」                           姓,名
 *
 * **1人目だけを採る。** 共著・訳者まで並べると `author` が長大になり、
 * 記事上の表示が崩れる（訳者は translator に入れる想定）。
 */
function cleanOpenBdAuthor(raw) {
  if (!raw) return "";
  const first = String(raw).split(/[／/　]/)[0];
  return (
    first
      // 生没年（Locke,John,1632-1704）
      .replace(/,\s*\d{4}-(?:\d{4})?/g, "")
      // 「姓,名」→「姓 名」。区切りのコンマをそのまま残すと日本語として読めない
      .replace(/,\s*/g, " ")
      .replace(/\s*(著|編|編著|監修|訳)$/, "")
      .trim()
  );
}

/**
 * openBD の書名から並列書名を落とす。
 * 「とにかく仕組み化 = Anyway,Systematize : 人の上に立ち続けるための思考法」の
 * ような形で返るため、` = ` 以降を捨てて副題（` : `）は残す。
 */
function cleanOpenBdTitle(raw) {
  return String(raw ?? "")
    .replace(/\s*=\s*[^:：]*?(?=\s*[:：]|$)/, "")
    .trim();
}

/**
 * 内容紹介（description）の整形。
 * openBD は HTML タグ混じり、Google Books は `<p>` や `<br>` を含めて返す。
 * 記事の「概要・選書理由」欄にそのまま入る文字なので、素のテキストに落とす。
 */
function cleanDescription(raw) {
  return String(raw ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * openBD の内容紹介は onix.CollateralDetail.TextContent にある。
 * TextType は 03（内容紹介）と 04（目次）が混ざるので、**03 だけ**を採る。
 * 目次を選書理由欄に流し込んでも書く材料にならない。
 */
function openBdDescription(record) {
  const list = record?.onix?.CollateralDetail?.TextContent;
  if (!Array.isArray(list)) return "";
  const item =
    list.find((t) => t?.TextType === "03") ??
    list.find((t) => t?.TextType === "02");
  return cleanDescription(item?.Text);
}

/**
 * 取得結果は3状態で返す。
 *
 *   found       値が取れた
 *   none        問い合わせたが、その本の情報が無かった
 *   unavailable 429・タイムアウト・5xx。**今は答えられない**
 *
 * `none` と `unavailable` を混ぜると、Google Books の上限に当たった日に
 * **openBD の図書館形式が黙って正しい値を上書きする**。実際に起きた
 * （「クレイトン・クリステンセン」→「Christensen,ClaytonM 玉田,俊平太 伊豆原,弓」）。
 */
function unavailable() {
  return { status: "unavailable" };
}

async function fetchOpenBd(isbn) {
  try {
    const res = await fetch(`https://api.openbd.jp/v1/get?isbn=${isbn}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 429 || res.status >= 500) return unavailable();
    if (!res.ok) return { status: "none" };
    const record = (await res.json())?.[0];
    const s = record?.summary;
    if (!s?.title) return { status: "none" };
    return {
      status: "found",
      data: {
        title: cleanOpenBdTitle(s.title),
        volume: String(s.volume ?? "").trim(),
        author: cleanOpenBdAuthor(s.author),
        publisher: String(s.publisher ?? "").trim(),
        year: parseYear(s.pubdate),
        description: openBdDescription(record),
      },
    };
  } catch {
    return unavailable();
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
    if (res.status === 429 || res.status >= 500) return unavailable();
    if (!res.ok) return { status: "none" };
    const v = (await res.json())?.items?.[0]?.volumeInfo;
    if (!v?.title) return { status: "none" };
    const authors = v.authors ?? [];
    return {
      status: "found",
      data: {
        title: String(v.title).trim(),
        author: authors[0] ?? "",
        translator: authors[1] ?? "",
        publisher: String(v.publisher ?? "").trim(),
        year: parseYear(v.publishedDate),
        description: cleanDescription(v.description),
      },
    };
  } catch {
    return unavailable();
  }
}

/**
 * 項目ごとに良い方を採る。実測にもとづく優先順位:
 *   書名・著者 → Google Books（openBD は叢書名・巻次・図書館形式が混ざる）
 *   出版社     → openBD（Google Books は返さない）
 *
 * **優先する側が `unavailable` のときは、劣る側で埋めない。**
 * 埋めてしまうと、既に整った値が図書館形式に差し替わる。
 * その場合は `degraded` を立て、画面側で**既存の値を残す**。
 */
async function lookupIsbn(isbn) {
  const [ores, gres] = await Promise.all([
    fetchOpenBd(isbn),
    fetchGoogleBooks(isbn),
  ]);
  const o = ores.status === "found" ? ores.data : null;
  const g = gres.status === "found" ? gres.data : null;

  const warnings = [];
  const degraded = [];

  if (gres.status === "unavailable") {
    // 原因を分けて出す。「キーが渡っていない」と「自分の枠を使い切った」は
    // どちらも 429 になるが、直し方がまったく違う。実際に、キー未設定を
    // 上限超過だと誤解して1日待つ、ということが起きた
    warnings.push(
      process.env.GOOGLE_BOOKS_API_KEY
        ? "Google Books が応答しません（1日あたりの上限の可能性）。書名・著者は今回更新しません"
        : "GOOGLE_BOOKS_API_KEY が設定されていません（.env を確認してください）。書名・著者は今回更新しません",
    );
    degraded.push("title", "author");
  }
  if (ores.status === "unavailable") {
    warnings.push("openBD が応答しません。出版社は今回更新しません");
    degraded.push("publisher");
  }

  if (!o && !g) {
    return {
      found: false,
      warnings: warnings.length > 0 ? warnings : ["書誌が取得できませんでした"],
      degraded,
    };
  }

  if (o && g && o.title !== g.title) {
    warnings.push(
      `書名の候補が2つ — openBD「${o.title}」/ Google「${g.title}」`,
    );
  }
  if (o?.volume) warnings.push(`openBD の巻次「${o.volume}」が混ざる可能性`);
  if (o?.year && g?.year && o.year !== g.year) {
    warnings.push(`刊行年が食い違う — openBD ${o.year} / Google ${g.year}`);
  }
  if (!o?.publisher && ores.status !== "unavailable") {
    warnings.push("出版社が取得できませんでした");
  }

  return {
    found: true,
    isbn,
    // degraded に入れた項目は空で返す。画面側が既存の値を残す
    title: degraded.includes("title") ? "" : g?.title || o?.title || "",
    author: degraded.includes("author") ? "" : g?.author || o?.author || "",
    translator: g?.translator || "",
    publisher: degraded.includes("publisher")
      ? ""
      : o?.publisher || g?.publisher || "",
    year: o?.year ?? g?.year ?? "",
    // 内容紹介。日本語書籍は openBD のほうが具体的なので先に見る。
    // 画面側では「概要・選書理由」欄が**空のときだけ**入れる（書いた文を消さない）
    description: o?.description || g?.description || "",
    warnings,
    degraded,
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
    // 自前画像が最優先。ここは cover.ts に任せる
    // （findLocalCover はメモ化の外なので、置いた直後でも拾える）
    if (hasLocalCover(isbn)) {
      const { resolveCover } = await loadCoverModule(server);
      return await resolveCover(isbn);
    }

    // **書いた直後の値を自分で返す。**
    // src/data/covers.json は Vite の監視から外してある（astro.config.mjs）。
    // 外さないと書き込みのたびに画面がリロードされて入力が消えるが、
    // 外したぶん cover.ts が静的 import している記録は古いままになる。
    // ここで cover.ts に解決させ直すと、**いま記録した本が「書影なし」に見える。**
    const entry = await lookupAndRemember(isbn);
    if (entry) return { url: entry.url, source: entry.source };

    // 429・タイムアウトで結論が出なかった。記録もしていない
    return { url: null, source: "fallback" };
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

/* ------------------------------------------------------------------ *
 * 選者マスタ
 * ------------------------------------------------------------------ */

/**
 * 選者を登録・編集する。
 *
 * **ID は編集できない。** 変えると `/selectors/<id>/` が変わって
 * 公開済みのリンクが切れるうえ、記事側の `selector:` が宙に浮いてビルドが落ちる
 * （CLI 側にも同じ制約がある）。画面では読み取り専用にしてあるが、
 * 口としても `editing` のときは既存IDでなければ弾く。
 *
 * 記事の保存と違って mtime の突き合わせはしない。選者マスタは1ファイルに
 * 全員が入っているため、**書くたびに読み直して該当IDだけ差し替える**。
 * こうしておくと、別の選者を編集している最中に他方を保存しても消えない。
 */
function saveSelector(data) {
  const selectors = readSelectors();
  const existingIds = Object.keys(selectors);
  const id = String(data.id ?? "")
    .trim()
    .toLowerCase();
  const editing = Boolean(data.editing);
  const selector = buildSelector(data);

  // 新規で既存IDを書こうとした場合もここで落ちる（validateSelector が弾く）。
  // 上書きの確認は出さない。**登録済みの選者を丸ごと置き換える操作**であり、
  // 直したいなら一覧から選んで編集に入るのが正しい道筋だから
  const errors = validateSelector({ id, selector, existingIds, editing });
  if (errors.length > 0) return { status: 400, body: { errors } };

  selectors[id] = selector;
  const filePath = writeSelectors(selectors);

  return {
    status: 200,
    body: {
      ok: true,
      id,
      selector,
      path: path.relative(ROOT, filePath),
      warnings: selectorWarnings(selector),
    },
  };
}

/**
 * 顔写真を `public/selectors/<ID>.<ext>` に置く。
 *
 * ファイル名を**選者IDに揃える**。応募フォームから届く画像は
 * `IMG_1234.jpeg` のような名前で、そのまま置くと数が増えたときに
 * どれが誰か分からなくなる（`docs/apply-form.md` でも改名する運用にしている）。
 *
 * 画像は変換もリサイズもしない。書影と同じで、加工した版を配る筋合いがない
 * （表示側が `object-fit: cover` で正方形に切り抜く）。
 */
async function uploadAvatar(server, body) {
  const { AVATAR_EXTENSIONS } = await server.ssrLoadModule(
    "/src/lib/selectors.ts",
  );

  const id = String(body.id ?? "")
    .trim()
    .toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
    return { status: 400, body: { error: "先に選者IDを入れてください" } };
  }

  const ext = String(body.filename ?? "")
    .toLowerCase()
    .match(/\.[a-z0-9]+$/)?.[0];
  if (!ext || !AVATAR_EXTENSIONS.includes(ext)) {
    return {
      status: 400,
      body: { error: `拡張子は ${AVATAR_EXTENSIONS.join(" / ")} のみです` },
    };
  }

  let buf;
  try {
    buf = Buffer.from(String(body.data ?? ""), "base64");
  } catch {
    buf = Buffer.alloc(0);
  }
  if (buf.length === 0)
    return { status: 400, body: { error: "ファイルが空です" } };
  if (buf.length > MAX_IMAGE_BYTES) {
    return {
      status: 400,
      body: {
        error: `ファイルが大きすぎます（${Math.round(buf.length / 1024)}KB / 上限 ${MAX_IMAGE_BYTES / 1024 / 1024}MB）`,
      },
    };
  }

  const actual = sniffImage(buf);
  if (!actual)
    return { status: 400, body: { error: "画像ファイルではありません" } };
  if (actual !== EXTENSION_FORMAT[ext]) {
    return {
      status: 400,
      body: { error: `中身は ${actual} です。${ext} ではありません` },
    };
  }

  // 拡張子違いの同名ファイルが残ると、`avatar` に書いていないほうが
  // ディレクトリに居座る。書影と同じく「1人につき1ファイル」に揃える
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
  const filename = `${id}${ext}`;
  fs.writeFileSync(path.join(AVATARS_DIR, filename), buf);
  const replaced = AVATAR_EXTENSIONS.map((e) => `${id}${e}`).filter(
    (name) => name !== filename && fs.existsSync(path.join(AVATARS_DIR, name)),
  );
  for (const name of replaced) fs.rmSync(path.join(AVATARS_DIR, name));

  return {
    status: 200,
    body: {
      ok: true,
      // そのまま selectors.json の avatar に入る値。画面が自前で組み立てると
      // 「置けたのに出ない」が起きる
      avatar: filename,
      url: `/selectors/${filename}`,
      path: `public/selectors/${filename}`,
      replaced,
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
      // キーが無いと Google Books は共有枠になり、すぐ 429 で落ちる。
      // 書誌も書影も静かに劣化するので、起動時に気づけるようにしておく
      if (!process.env.GOOGLE_BOOKS_API_KEY) {
        console.warn(
          "[admin] GOOGLE_BOOKS_API_KEY がありません。" +
            "書名・著者・書影が取得できません（.env を確認してください）",
        );
      }

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

          if (url === "/api/selectors.json") {
            return send(200, { selectors: readSelectors() });
          }

          if (url === "/api/save-selector.json") {
            const { status, body: out } = saveSelector(body);
            return send(status, out);
          }

          if (url === "/api/upload-avatar.json") {
            const { status, body: out } = await uploadAvatar(server, body);
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
