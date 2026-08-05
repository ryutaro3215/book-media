import fs from "node:fs";
import path from "node:path";

/**
 * 記事サムネイルの解決。
 *
 *   1. public/thumbnails/<slug>.jpg|.jpeg|.png|.webp があればそれを使う
 *   2. なければ、その記事の OGP 画像 /og/<slug>.png を流用する
 *
 * 2 があるので「サムネイルを用意しないと見た目が崩れる」状態にはならない。
 * 記事を出すたびに画像制作が発生すると、記事を出し切ること自体の障害になるため、
 * 用意は任意にしてある（書影と同じ「登録があれば優先」の構造）。
 */
const THUMBNAILS_DIR = path.resolve(process.cwd(), "public/thumbnails");
const EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;

export function resolveThumbnail(slug: string): string {
  for (const ext of EXTENSIONS) {
    if (fs.existsSync(path.join(THUMBNAILS_DIR, `${slug}${ext}`))) {
      return `/thumbnails/${slug}${ext}`;
    }
  }
  return `/og/${slug}.png`;
}
