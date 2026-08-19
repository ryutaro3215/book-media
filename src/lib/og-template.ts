/**
 * OGP画像（1200×630）のテンプレートとレンダリング。
 *
 * design/OGP.dc.html がデザインの正。配色は src/styles/global.css の
 * トークンと同じ実値を使う（satori は CSS 変数を解決できないため、
 * ここだけは HEX を直に持つ。値を変えるときは global.css と揃えること）。
 *
 * 生成はビルド時のみ（src/pages/og/[...slug].png.ts の getStaticPaths 経由）。
 * ランタイムでは一切実行されない。
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

/** global.css の @theme と同値 */
const COLOR = {
  canvas: "#FFFFFF",
  ink: "#292929",
  muted: "#787878",
  rule: "#E6E6E6",
  brand: "#B4552F",
} as const;

const FONT_FAMILY = "Zen Kaku Gothic New";

/**
 * satori は woff2 を読めない（woff / ttf / otf のみ）。
 * public/fonts/ に置いてあるのは woff2 なので、同じ書体の woff 版が入っている
 * @fontsource パッケージのファイルを直接読む。外部CDNは使わない。
 *
 * import.meta.url はビルド後の dist/ 配下のチャンクを指してしまうため、
 * パッケージ解決（createRequire）でフォントの実体を探す。
 */
const FONT_DIR = (() => {
  const require = createRequire(pathToFileURL(path.join(process.cwd(), "/")));
  const pkgJson = require.resolve(
    "@fontsource/zen-kaku-gothic-new/package.json",
  );
  return path.join(path.dirname(pkgJson), "files");
})();

type FontSpec = { subset: "japanese" | "latin"; weight: 400 | 500 | 900 };

/**
 * satori は「同じ family 名 + 同じ weight」の複数フォントを重ねられない
 * （後勝ち／先勝ちで片方が捨てられ、和文が空白になる）。
 * japanese サブセットは latin の範囲も含んでいるので、japanese だけを渡す。
 */
const FONT_SPECS: FontSpec[] = [
  { subset: "japanese", weight: 400 },
  { subset: "japanese", weight: 500 },
  { subset: "japanese", weight: 900 },
];

let fontCache: Awaited<ReturnType<typeof loadFonts>> | null = null;

async function loadFonts() {
  return FONT_SPECS.map(({ subset, weight }) => {
    const file = path.join(
      FONT_DIR,
      `zen-kaku-gothic-new-${subset}-${weight}-normal.woff`,
    );
    return {
      name: FONT_FAMILY,
      data: fs.readFileSync(file),
      weight: weight as 400 | 500 | 900,
      style: "normal" as const,
    };
  });
}

async function getFonts() {
  if (!fontCache) fontCache = await loadFonts();
  return fontCache;
}

export type OgImageInput = {
  /** 記事タイトル。画像内で最も大きい要素 */
  title: string;
  /** 選者名。タイトルの下に添える */
  selectorName: string;
  /** 分野名 */
  topic: string;
  /** 紹介する全書名（先頭2点のみ描画し、残りは「ほかN冊」にまとめる） */
  bookTitles: string[];
  /** サイト名 */
  siteName: string;
  /**
   * 先頭の書影（base64 data URI）。satori はリモートURLを取得できないため、
   * 呼び出し側（[...slug].png.ts）で事前にバイト列化して渡す。
   * 取得できなかった場合は null（そのときは書影枠を描かない）。
   */
  coverImage: string | null;
};

/**
 * 書名は2点まで。残りは「ほかN冊」。
 * 長い書名で1行に収まらなくなるのを避けるため、全体の文字数でも切り詰める。
 */
function formatBookLine(titles: string[]): string {
  const shown: string[] = [];
  let budget = 26; // 全角換算のおおよその上限（font-size 30px / 幅 1024px）
  for (const t of titles.slice(0, 2)) {
    if (shown.length > 0 && t.length > budget) break;
    shown.push(t);
    budget -= t.length + 1;
    if (budget <= 0) break;
  }
  const rest = titles.length - shown.length;
  const head = shown.join("／");
  return rest > 0 ? `${head} ほか${rest}冊` : head;
}

/** タイトルの長さに応じて字送りを落とす（短ければ大きく、長くても溢れさせない） */
function titleFontSize(title: string): number {
  if (title.length <= 16) return 56;
  if (title.length <= 24) return 48;
  if (title.length <= 32) return 40;
  return 34;
}

/** 書影の枠寸法。BookCover.astro の152×228と同じ縦横比を保つ */
const COVER_WIDTH = 168;
const COVER_HEIGHT = 252;

/** satori に渡すノード木（JSXを使わずオブジェクトで組む） */
function template(input: OgImageInput) {
  const el = (type: string, props: Record<string, unknown>) => ({
    type,
    props,
  });

  const metaText = (text: string) =>
    el("span", { style: { display: "flex" }, children: text });

  const textColumn = el("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      flex: 1,
      minWidth: 0,
      // 書影があるときだけ右に余白を空ける
      paddingRight: input.coverImage ? 48 : 0,
    },
    children: [
      // 1) 分野名 ／ N冊
      el("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 18,
          fontSize: 26,
          fontWeight: 500,
          color: COLOR.muted,
          letterSpacing: "0.04em",
          marginBottom: 22,
        },
        children: [
          metaText(input.topic),
          el("div", {
            style: {
              display: "flex",
              width: 1,
              height: 20,
              backgroundColor: COLOR.rule,
            },
          }),
          metaText(`${input.bookTitles.length}冊`),
        ],
      }),
      // 2) 記事タイトル（最大要素）
      el("div", {
        style: {
          display: "flex",
          fontSize: titleFontSize(input.title),
          fontWeight: 900,
          lineHeight: 1.4,
          letterSpacing: "-0.02em",
          marginBottom: 28,
        },
        children: input.title,
      }),
      // 3) 選者名（タイトルの主語なので添える）
      el("div", {
        style: {
          display: "flex",
          fontSize: 26,
          fontWeight: 500,
          color: COLOR.muted,
          marginBottom: 20,
        },
        children: `選: ${input.selectorName}`,
      }),
      // 4) 書名（2点 + ほかN冊）
      el("div", {
        style: {
          display: "flex",
          fontSize: 26,
          fontWeight: 400,
          color: COLOR.muted,
          lineHeight: 1.5,
        },
        children: formatBookLine(input.bookTitles),
      }),
    ],
  });

  const cover = input.coverImage
    ? el("img", {
        src: input.coverImage,
        width: COVER_WIDTH,
        height: COVER_HEIGHT,
        style: {
          display: "flex",
          flex: "0 0 auto",
          objectFit: "cover",
          boxShadow: "0 2px 8px rgba(41,41,41,0.18)",
        },
      })
    : null;

  return el("div", {
    style: {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      backgroundColor: COLOR.canvas,
      color: COLOR.ink,
      fontFamily: FONT_FAMILY,
      padding: "72px 88px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
    },
    children: [
      el("div", {
        style: {
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-start",
        },
        children: cover ? [textColumn, cover] : [textColumn],
      }),
      // 5) サイト名（小さく）
      el("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 24,
          fontWeight: 500,
          color: COLOR.muted,
        },
        children: [
          el("div", {
            style: {
              display: "flex",
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: COLOR.brand,
            },
          }),
          metaText(input.siteName),
        ],
      }),
    ],
  });
}

/**
 * サイト共通の面（トップ・固定ページ・Xでの紹介用）。
 *
 * **記事用テンプレートを流用しない。** 流用していたときは
 * 「その道の人しか知らない本 ｜ 1冊」という見出しが出ていた。
 * 1冊は `bookTitles` の要素数（説明文1つ）を数えたもので、意味が無い。
 * サイト名も見出しと足元で二重に出ていた。
 *
 * ここは「何のメディアか」だけを伝える面にする。
 */
export type SiteOgInput = {
  siteName: string;
  /** 一言。長いと読まれないので、呼び出し側で短く渡す */
  tagline: string;
  /** 足元に出す補助行（公開中の分野など）。省略可 */
  footnote?: string;
};

function siteTemplate(input: SiteOgInput) {
  const el = (type: string, props: Record<string, unknown>) => ({
    type,
    props,
  });

  return el("div", {
    style: {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      backgroundColor: COLOR.canvas,
      color: COLOR.ink,
      fontFamily: FONT_FAMILY,
      padding: "84px 88px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
    },
    children: [
      el("div", {
        style: { display: "flex", flexDirection: "column" },
        children: [
          // サイト名（最大要素）。ブランドの点を添える
          el("div", {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 22,
              marginBottom: 36,
            },
            children: [
              el("div", {
                style: {
                  display: "flex",
                  width: 20,
                  height: 20,
                  borderRadius: 10,
                  backgroundColor: COLOR.brand,
                },
              }),
              el("div", {
                style: {
                  display: "flex",
                  fontSize: 96,
                  fontWeight: 900,
                  lineHeight: 1.1,
                  letterSpacing: "-0.02em",
                },
                children: input.siteName,
              }),
            ],
          }),
          el("div", {
            style: {
              display: "flex",
              fontSize: 38,
              fontWeight: 500,
              lineHeight: 1.6,
              color: COLOR.ink,
            },
            children: input.tagline,
          }),
        ],
      }),
      ...(input.footnote
        ? [
            el("div", {
              style: {
                display: "flex",
                fontSize: 26,
                fontWeight: 400,
                color: COLOR.muted,
                letterSpacing: "0.04em",
              },
              children: input.footnote,
            }),
          ]
        : []),
    ],
  });
}

/** satori → PNG。面が2種類あるので描画部分だけ共通にしておく */
async function toPng(node: unknown): Promise<Uint8Array> {
  const fonts = await getFonts();
  const svg = await satori(node as never, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts,
  });
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: OG_WIDTH },
    font: { loadSystemFonts: false },
  });
  return resvg.render().asPng();
}

/* ------------------------------------------------------------------ *
 * X 添付用の紹介画像（16:9）
 * ------------------------------------------------------------------ */

export const SHARE_WIDTH = 1200;
export const SHARE_HEIGHT = 675;

export type ShareImageInput = {
  siteName: string;
  /**
   * 何をやっているのかの説明（複数行）。
   *
   * **記事の紹介より先に置く。** いきなり個別の記事タイトルを並べると、
   * 「本の紹介がいくつかある」までしか伝わらない。
   * 分野をまたいで積み上げていく場だ、というところを先に言う。
   */
  lead: string[];
  /** 例として出す記事。「こんな記事があります」の位置づけ */
  articles: Array<{ topic: string; title: string }>;
  footnote: string;
};

/** タイトルが長いと3本が入らないので、行に収まる長さで畳む */
function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function shareTemplate(input: ShareImageInput) {
  const el = (type: string, props: Record<string, unknown>) => ({
    type,
    props,
  });

  return el("div", {
    style: {
      width: SHARE_WIDTH,
      height: SHARE_HEIGHT,
      backgroundColor: COLOR.canvas,
      color: COLOR.ink,
      fontFamily: FONT_FAMILY,
      padding: "64px 80px",
      display: "flex",
      flexDirection: "column",
      justifyContent: "space-between",
    },
    children: [
      // サイト名 + 説明
      el("div", {
        style: { display: "flex", flexDirection: "column" },
        children: [
          el("div", {
            style: { display: "flex", alignItems: "center", gap: 16 },
            children: [
              el("div", {
                style: {
                  display: "flex",
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  backgroundColor: COLOR.brand,
                },
              }),
              el("div", {
                style: {
                  display: "flex",
                  fontSize: 52,
                  fontWeight: 900,
                  letterSpacing: "-0.02em",
                },
                children: input.siteName,
              }),
            ],
          }),
          el("div", {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: 10,
              marginTop: 28,
            },
            children: input.lead.map((line, i) =>
              el("div", {
                style: {
                  display: "flex",
                  fontSize: i === 0 ? 38 : 28,
                  fontWeight: i === 0 ? 700 : 400,
                  lineHeight: 1.5,
                  color: i === 0 ? COLOR.ink : COLOR.muted,
                },
                children: line,
              }),
            ),
          }),
        ],
      }),

      // 例として出す記事
      el("div", {
        style: { display: "flex", flexDirection: "column", gap: 14 },
        children: [
          el("div", {
            style: {
              display: "flex",
              fontSize: 22,
              fontWeight: 500,
              color: COLOR.muted,
              letterSpacing: "0.08em",
            },
            children: "たとえば、こんな記事があります",
          }),
          ...input.articles.map((a) =>
            el("div", {
              style: { display: "flex", alignItems: "baseline", gap: 20 },
              children: [
                el("div", {
                  style: {
                    display: "flex",
                    width: 110,
                    fontSize: 22,
                    fontWeight: 500,
                    color: COLOR.brand,
                  },
                  children: a.topic,
                }),
                el("div", {
                  style: {
                    display: "flex",
                    fontSize: 26,
                    fontWeight: 500,
                    lineHeight: 1.4,
                  },
                  children: clip(a.title, 34),
                }),
              ],
            }),
          ),
        ],
      }),

      el("div", {
        style: {
          display: "flex",
          fontSize: 22,
          fontWeight: 400,
          color: COLOR.muted,
          letterSpacing: "0.04em",
        },
        children: input.footnote,
      }),
    ],
  });
}

/** X 添付用（1200×675）。OGPカードとは別の面 */
export async function renderShareImage(
  input: ShareImageInput,
): Promise<Uint8Array> {
  const fonts = await getFonts();
  const svg = await satori(shareTemplate(input) as never, {
    width: SHARE_WIDTH,
    height: SHARE_HEIGHT,
    fonts,
  });
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: SHARE_WIDTH },
    font: { loadSystemFonts: false },
  });
  return resvg.render().asPng();
}

/** サイト共通の面を 1200×630 の PNG で返す */
export async function renderSiteOgImage(
  input: SiteOgInput,
): Promise<Uint8Array> {
  return toPng(siteTemplate(input));
}

/** 1200×630 の PNG バイナリを返す */
export async function renderOgImage(input: OgImageInput): Promise<Uint8Array> {
  return toPng(template(input));
}
