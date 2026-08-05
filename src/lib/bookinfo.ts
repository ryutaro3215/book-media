/**
 * ISBN から**書誌メタデータ**を取得する（書影ではない）。
 *
 * 記事を書くときの手入力を減らすのが目的。
 * 書影の解決は `src/lib/cover.ts` が別途おこなう。
 *
 * ## 取得順
 *   1. openBD  — 日本語書籍の書誌に強い。出版社のオプトイン制
 *   2. Google Books — 補完。日本語書籍のカバレッジは低いと見込まれる
 *
 * ## 注意
 * 本メディアが扱うのは「絶版・少部数・埋もれた本」であり、
 * **データベースのカバレッジが最も薄い領域**にあたる。
 * 自動取得は「埋まれば儲けもの」であって、**取れない前提で運用する**。
 *
 * 失敗しても例外は投げず null を返す。
 */

const OPENBD_ENDPOINT = "https://api.openbd.jp/v1/get";
const GOOGLE_BOOKS_ENDPOINT = "https://www.googleapis.com/books/v1/volumes";

const TIMEOUT_MS = 8000;

/** どこから取れたか。実測とデバッグのために必ず持ち回る */
export type BookInfoSource = "openbd" | "googlebooks";

export type BookInfo = {
  isbn: string;
  source: BookInfoSource;
  title: string;
  /** 著者・訳者などをまとめた生の文字列（APIによって形式が違う） */
  authorsRaw: string;
  /** 分解できた場合の著者名。できなければ authorsRaw と同じ */
  author: string;
  /** 「◯◯ 訳」を判別できた場合のみ入る */
  translator?: string;
  publisher: string;
  /** 刊行年。取れなければ undefined */
  year?: number;
};

/** openBD の pubdate は "20141001" / "2014-10" / "2014" など揺れる */
function parseYear(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;
  const m = value.match(/(\d{4})/);
  if (!m) return undefined;
  const year = Number(m[1]);
  return year >= 1000 && year <= 2999 ? year : undefined;
}

/**
 * openBD の author は「カーネマン，ダニエル／村井 章子 訳」のように
 * 「／」区切りで役割付きの文字列が入る。訳者を分離できるところまでやる。
 */
function splitContributors(raw: string): {
  author: string;
  translator?: string;
} {
  const parts = raw
    .split(/[／/]/)
    .map((p) => p.trim())
    .filter((p) => p !== "");

  if (parts.length === 0) return { author: raw };

  const translatorPart = parts.find((p) => /訳$/.test(p));
  const authorPart = parts.find((p) => p !== translatorPart) ?? parts[0];

  return {
    author: authorPart.replace(/\s*(著|編|編著|監修)$/, "").trim(),
    translator: translatorPart?.replace(/\s*訳$/, "").trim(),
  };
}

type OpenBdRecord = {
  summary?: {
    isbn?: string;
    title?: string;
    volume?: string;
    series?: string;
    publisher?: string;
    pubdate?: string;
    author?: string;
  };
} | null;

async function fetchFromOpenBd(isbn: string): Promise<BookInfo | null> {
  try {
    const res = await fetch(
      `${OPENBD_ENDPOINT}?isbn=${encodeURIComponent(isbn)}`,
      {
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;

    const json = (await res.json()) as OpenBdRecord[];
    const s = json?.[0]?.summary;
    if (!s) return null;

    const title = [s.title, s.volume].filter(Boolean).join(" ").trim();
    if (title === "") return null;

    const authorsRaw = (s.author ?? "").trim();
    const { author, translator } = splitContributors(authorsRaw);

    return {
      isbn,
      source: "openbd",
      title,
      authorsRaw,
      author: author || authorsRaw,
      translator,
      publisher: (s.publisher ?? "").trim(),
      year: parseYear(s.pubdate),
    };
  } catch {
    return null;
  }
}

type GoogleBooksResponse = {
  totalItems?: number;
  items?: Array<{
    volumeInfo?: {
      title?: string;
      subtitle?: string;
      authors?: string[];
      publisher?: string;
      publishedDate?: string;
    };
  }>;
};

async function fetchFromGoogleBooks(isbn: string): Promise<BookInfo | null> {
  try {
    // キーは無くても動く（レート制限が緩くなるだけ）。
    // ビルド/CLI 時にしか使わないので PUBLIC_ を付けない
    // astro dev では .env が process.env に入らないため import.meta.env も見る。
    // これを忘れると開発時だけキーなしで叩き、429 で書影が取れなくなる
    const key =
      import.meta.env.GOOGLE_BOOKS_API_KEY ?? process.env.GOOGLE_BOOKS_API_KEY;
    const url = new URL(GOOGLE_BOOKS_ENDPOINT);
    url.searchParams.set("q", `isbn:${isbn}`);
    url.searchParams.set("country", "JP");
    if (key) url.searchParams.set("key", key);

    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;

    const json = (await res.json()) as GoogleBooksResponse;
    const v = json?.items?.[0]?.volumeInfo;
    if (!v?.title) return null;

    const title = [v.title, v.subtitle].filter(Boolean).join(" ").trim();
    const authorsRaw = (v.authors ?? []).join(" / ");

    return {
      isbn,
      source: "googlebooks",
      title,
      authorsRaw,
      author: v.authors?.[0] ?? authorsRaw,
      publisher: (v.publisher ?? "").trim(),
      year: parseYear(v.publishedDate),
    };
  } catch {
    return null;
  }
}

/**
 * ISBN13 から書誌を引く。openBD → Google Books の順。
 * どちらでも取れなければ null（＝手入力する）。
 */
export async function fetchBookInfo(isbn: string): Promise<BookInfo | null> {
  const normalized = isbn.replace(/[^\d]/g, "");
  if (!/^\d{13}$/.test(normalized)) return null;

  return (
    (await fetchFromOpenBd(normalized)) ??
    (await fetchFromGoogleBooks(normalized))
  );
}

/** 実測用。両方のAPIを個別に叩いて、それぞれの結果を返す */
export async function fetchBookInfoFromBoth(isbn: string): Promise<{
  openbd: BookInfo | null;
  googlebooks: BookInfo | null;
}> {
  const normalized = isbn.replace(/[^\d]/g, "");
  const [openbd, googlebooks] = await Promise.all([
    fetchFromOpenBd(normalized),
    fetchFromGoogleBooks(normalized),
  ]);
  return { openbd, googlebooks };
}
