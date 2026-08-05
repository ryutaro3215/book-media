/**
 * openBD API クライアント（ビルド時にのみ呼ばれる）。
 *
 * openBD は `summary.cover` に書影URLを返すが、**空文字列を返すことが非常に多い**。
 * 空文字列は「書影なし」として扱い、必ず判定してから返すこと。
 *
 * 失敗（ネットワーク断・タイムアウト・不正なJSON）は例外を投げずに `null` を返す。
 * ビルドを落とさないことが最優先（plan.md T5 acceptance）。
 */

const OPENBD_ENDPOINT = "https://api.openbd.jp/v1/get";

/** 外部APIの応答待ちの上限。ビルド全体を止めないための保険 */
export const FETCH_TIMEOUT_MS = 5000;

type OpenBdRecord = {
  summary?: {
    cover?: string;
    title?: string;
    publisher?: string;
    pubdate?: string;
  };
} | null;

/**
 * ISBN（13桁）から openBD の書影URLを取得する。
 * 取得できない場合は `null`。例外は投げない。
 */
export async function fetchOpenBdCover(isbn: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${OPENBD_ENDPOINT}?isbn=${encodeURIComponent(isbn)}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) return null;

    const json = (await res.json()) as OpenBdRecord[];
    const cover = json?.[0]?.summary?.cover;

    // openBD は書影がなくても空文字列を返す。必ず中身を確認する
    if (typeof cover !== "string") return null;
    const trimmed = cover.trim();
    if (trimmed === "") return null;

    return trimmed;
  } catch {
    // ネットワーク断・タイムアウト・JSONパース失敗 — 静かに次の経路へ倒す
    return null;
  }
}

const GOOGLE_BOOKS_ENDPOINT = "https://www.googleapis.com/books/v1/volumes";

type GoogleBooksResponse = {
  totalItems?: number;
  items?: Array<{
    volumeInfo?: {
      imageLinks?: {
        thumbnail?: string;
        smallThumbnail?: string;
      };
    };
  }>;
};

/**
 * ISBN（13桁）から Google Books の書影URLを取得する。
 * 取得できない場合は `null`。例外は投げない。
 */
export async function fetchGoogleBooksCover(
  isbn: string,
): Promise<string | null> {
  try {
    // APIキーがないと共有IPのクォータで 429 になり、実質いつも失敗する。
    // 実測: キーなし 0/10 → キーあり 7/10。必ず渡すこと。
    // ビルド時にしか使わないので PUBLIC_ は付けない（クライアントに露出させない）
    const url = new URL(GOOGLE_BOOKS_ENDPOINT);
    url.searchParams.set("q", `isbn:${isbn}`);
    url.searchParams.set("country", "JP");
    const key = process.env.GOOGLE_BOOKS_API_KEY;
    if (key) url.searchParams.set("key", key);

    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;

    const json = (await res.json()) as GoogleBooksResponse;
    const thumbnail = json?.items?.[0]?.volumeInfo?.imageLinks?.thumbnail;

    if (typeof thumbnail !== "string") return null;
    const trimmed = thumbnail.trim();
    if (trimmed === "") return null;

    // Google Books は http を返すことがある。混在コンテンツを避けるため https に寄せる
    return trimmed.replace(/^http:\/\//, "https://");
  } catch {
    return null;
  }
}
