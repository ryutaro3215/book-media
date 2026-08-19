/**
 * OGP画像に埋め込む書影の取得（ビルド時専用）。
 *
 * satori はリモートURLの画像を取得できず、`img.src` に渡せるのは
 * data URI（またはSVG内で解決済みのバイト列）だけ。
 * `resolveCover()` が返すのは表示用のURL（自前パス or 外部URL）なので、
 * ここで実バイト列を取りに行って base64 化する。
 *
 * 取得に失敗しても例外は投げない。OGP画像生成そのものを止める価値はなく、
 * 書影なしのレイアウトにフォールバックすれば十分。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const PUBLIC_DIR = path.resolve(process.cwd(), "public");

function extToMime(url: string): string {
  const ext = path.extname(url).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  return "image/jpeg";
}

/**
 * `resolveCover()` の返す `url`（自前パス `/covers/xxx.jpg` か外部URL）から
 * data URI を組み立てる。`url` が null ならそのまま null を返す。
 */
export async function fetchCoverAsDataUri(
  url: string | null,
): Promise<string | null> {
  if (!url) return null;

  try {
    if (url.startsWith("/")) {
      const bytes = await readFile(path.join(PUBLIC_DIR, url));
      return `data:${extToMime(url)};base64,${bytes.toString("base64")}`;
    }

    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? extToMime(url);
    return `data:${contentType};base64,${bytes.toString("base64")}`;
  } catch {
    // 書影が引けなくても OGP 画像そのものは生成する
    return null;
  }
}
