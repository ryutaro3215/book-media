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
  /** 選者名。画像内で最も大きい要素 */
  selectorName: string;
  /** 分野名 */
  topic: string;
  /** 紹介する全書名（先頭2点のみ描画し、残りは「ほかN冊」にまとめる） */
  bookTitles: string[];
  /** サイト名 */
  siteName: string;
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

/** 選者名の長さに応じて字送りを落とす（4文字なら100px、長い名前でも溢れさせない） */
function selectorFontSize(name: string): number {
  if (name.length <= 5) return 100;
  if (name.length <= 7) return 88;
  if (name.length <= 10) return 72;
  return 60;
}

/** satori に渡すノード木（JSXを使わずオブジェクトで組む） */
function template(input: OgImageInput) {
  const el = (type: string, props: Record<string, unknown>) => ({
    type,
    props,
  });

  const metaText = (text: string) =>
    el("span", { style: { display: "flex" }, children: text });

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
        style: { display: "flex", flexDirection: "column" },
        children: [
          // 1) 分野名 ／ N冊
          el("div", {
            style: {
              display: "flex",
              alignItems: "center",
              gap: 18,
              fontSize: 30,
              fontWeight: 500,
              color: COLOR.muted,
              letterSpacing: "0.04em",
              marginBottom: 24,
            },
            children: [
              metaText(input.topic),
              el("div", {
                style: {
                  display: "flex",
                  width: 1,
                  height: 22,
                  backgroundColor: COLOR.rule,
                },
              }),
              metaText(`${input.bookTitles.length}冊`),
            ],
          }),
          // 2) 選者名（最大要素）
          el("div", {
            style: {
              display: "flex",
              fontSize: selectorFontSize(input.selectorName),
              fontWeight: 900,
              lineHeight: 1.15,
              letterSpacing: "-0.02em",
              marginBottom: 32,
            },
            children: input.selectorName,
          }),
          // 3) 書名（2点 + ほかN冊）
          el("div", {
            style: {
              display: "flex",
              fontSize: 30,
              fontWeight: 400,
              color: COLOR.muted,
              lineHeight: 1.5,
            },
            children: formatBookLine(input.bookTitles),
          }),
        ],
      }),
      // 4) サイト名（小さく）
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

/** 1200×630 の PNG バイナリを返す */
export async function renderOgImage(input: OgImageInput): Promise<Uint8Array> {
  const fonts = await getFonts();
  const svg = await satori(template(input) as never, {
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
