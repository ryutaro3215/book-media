/**
 * openBD / Google Books の書影クライアント（ビルド時にのみ呼ばれる）。
 *
 * openBD は `summary.cover` に書影URLを返すが、**空文字列を返すことが非常に多い**。
 * 空文字列は「書影なし」として扱い、必ず判定してから返すこと。
 *
 * 失敗（ネットワーク断・タイムアウト・不正なJSON）は例外を投げずに返す。
 * ビルドを落とさないことが最優先（plan.md T5 acceptance）。
 *
 * ## 「書影が無い」と「今は答えられない」を呼び出し側に区別させる
 * 以前はどちらも `null` を返していた。そのため cover.ts 側では
 * 429（レート制限）で落ちたのか、本当に書影が存在しないのかが分からず、
 * **混んでいるときに引いた本だけが恒久的にフォールバックへ倒れていた。**
 * 再試行すべき失敗だけを再試行できるよう、理由を持たせて返す。
 */

const OPENBD_ENDPOINT = "https://api.openbd.jp/v1/get";

/** 外部APIの応答待ちの上限。ビルド全体を止めないための保険 */
export const FETCH_TIMEOUT_MS = 5000;

export type CoverLookup =
  /** 書影URLが取れた */
  | { status: "found"; url: string }
  /** 問い合わせは成立したが、この本に書影は無い。再試行しても変わらない */
  | { status: "none" }
  /** レート制限・タイムアウト・ネットワーク断。待てば取れる可能性がある */
  | { status: "unavailable" };

type OpenBdRecord = {
  summary?: {
    cover?: string;
    title?: string;
    publisher?: string;
    pubdate?: string;
  };
} | null;

/** 空文字列・空白のみを「無し」として弾く */
function asUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * ISBN（13桁）から openBD の書影URLを取得する。例外は投げない。
 */
export async function fetchOpenBdCover(isbn: string): Promise<CoverLookup> {
  try {
    const res = await fetch(
      `${OPENBD_ENDPOINT}?isbn=${encodeURIComponent(isbn)}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!res.ok) return { status: "unavailable" };

    const json = (await res.json()) as OpenBdRecord[];
    const cover = asUrl(json?.[0]?.summary?.cover);
    return cover ? { status: "found", url: cover } : { status: "none" };
  } catch {
    // ネットワーク断・タイムアウト・JSONパース失敗 — 待てば変わりうる
    return { status: "unavailable" };
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
 * ISBN（13桁）から Google Books の書影URLを取得する。例外は投げない。
 */
export async function fetchGoogleBooksCover(
  isbn: string,
): Promise<CoverLookup> {
  try {
    // APIキーがないと共有IPのクォータで 429 になり、実質いつも失敗する。
    // 実測: キーなし 0/10 → キーあり 7/10。必ず渡すこと。
    // ビルド時にしか使わないので PUBLIC_ は付けない（クライアントに露出させない）
    const url = new URL(GOOGLE_BOOKS_ENDPOINT);
    url.searchParams.set("q", `isbn:${isbn}`);
    url.searchParams.set("country", "JP");
    // astro dev では .env が process.env に入らないため import.meta.env も見る。
    // これを忘れると開発時だけキーなしで叩き、429 で書影が取れなくなる
    const key =
      import.meta.env.GOOGLE_BOOKS_API_KEY ?? process.env.GOOGLE_BOOKS_API_KEY;
    if (key) url.searchParams.set("key", key);

    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    // キーがあっても短時間に数十件投げれば 429 になる（実測 30件同時で 24件が 429）。
    // これは「書影が無い」ではないので、呼び出し側に再試行させる
    if (!res.ok) return { status: "unavailable" };

    const json = (await res.json()) as GoogleBooksResponse;
    const thumbnail = asUrl(
      json?.items?.[0]?.volumeInfo?.imageLinks?.thumbnail,
    );
    if (!thumbnail) return { status: "none" };

    // Google Books は http を返すことがある。混在コンテンツを避けるため https に寄せる
    return {
      status: "found",
      url: thumbnail.replace(/^http:\/\//, "https://"),
    };
  } catch {
    return { status: "unavailable" };
  }
}
