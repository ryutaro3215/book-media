import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { isKnownSelector, SELECTOR_IDS } from "./lib/selectors";
import { isKnownTopic, TOPIC_NAMES } from "./lib/topics";

/** CLI が書き込むプレースホルダかどうか */
function isPlaceholder(value: string): boolean {
  return value.trimStart().startsWith("TODO:");
}

/** 1冊分の書誌情報と選書理由。 */
const bookSchema = z.object({
  title: z.string().min(1),
  author: z.string().min(1),
  translator: z.string().min(1).optional(),
  publisher: z.string().min(1),
  year: z.number().int(),
  /** ハイフンなしの13桁のみ。`978-4-…` 形式はビルドエラーにする */
  isbn: z.string().regex(/^\d{13}$/, "isbn は13桁の数字のみ（ハイフン不可）"),
  /** 選書理由。draft のあいだは `TODO: …` のままでよい */
  reason: z.string().min(1),
});

/**
 * テーマ（お題）は `src/data/topics.json` に定義した語彙のみ許可する。
 *
 * 自由入力にすると「行動経済学」「行動経済学入門」「行動経済学 」のように
 * 表記が揺れ、アーカイブページが乱立する。新しいお題を立てるときは
 * topics.json に追記する必要があり、**その一手間が抑止として機能する**。
 */

const interviews = defineCollection({
  loader: glob({ base: "./src/content/interviews", pattern: "**/*.{md,mdx}" }),
  schema: z
    .object({
      title: z.string().min(1),
      /**
       * 検索結果に出る `<title>` だけを差し替える（任意）。
       *
       * 記事タイトルは「〈選者〉が選ぶ、〈テーマ〉の5冊」のような形で、
       * X共有時に「誰が選んだか」を伝えるためのもの。一方で検索する人は
       * 「〇〇 入門書」「〇〇 おすすめ 本」と打つため、語が噛み合わない。
       * 両立させるために、検索用のタイトルだけ別に持てるようにしてある。
       * 未指定なら title がそのまま使われる。
       */
      seoTitle: z.string().min(1).optional(),
      /**
       * URLになる。**半角小文字の英数とハイフンのみ。**
       * 日本語を許すと共有時にURLがエンコードされて長大化する
       * （Xでの共有が主要導線なので実害が大きい）。
       * 一度公開したURLは変えられないため、ここで弾く。
       */
      slug: z
        .string()
        .regex(
          /^[a-z0-9][a-z0-9-]*$/,
          "slug は半角小文字の英数とハイフンのみ（日本語不可・先頭はハイフン以外）",
        ),
      /**
       * 下書きかどうか。
       *
       * `true` のあいだは **TODO: のプレースホルダが残っていてもビルドが通り**、
       * 本番サイトには出ない（開発サーバーでは確認できる）。
       * 書き上がったら `false` にする。そこで初めて未記入が検出される。
       *
       * 記事はターミナルではなくエディタで少しずつ書く運用なので、
       * 途中の状態がビルドを壊さないようにしてある。
       *
       * **既定は false。** CLI は常に `draft: true` を明示して書き出すので、
       * 既定を true にすると「draft を書いていない既存記事が黙って消える」
       * という事故が起きる（実際に起きた）。書いていなければ公開扱いにする。
       */
      draft: z.boolean().default(false),
      publishedAt: z.date(),
      /** 内容を直したときに入れる。JSON-LD の dateModified に使う */
      updatedAt: z.date().optional(),
      description: z.string().min(1),
      /** src/data/topics.json に定義された語彙のみ */
      topic: z.string().refine(isKnownTopic, {
        message:
          `未登録のテーマです。src/data/topics.json に追記してください。` +
          `登録済み: ${TOPIC_NAMES.join(" / ")}`,
      }),
      keywords: z.array(z.string()).optional(),
      /**
       * 選者は情報を直接書かず、`src/data/selectors.json` のIDで参照する。
       * 所属や略歴が変わってもマスタ1箇所の修正で全記事に反映される。
       */
      selector: z.string().refine(isKnownSelector, {
        message:
          `未登録の選者IDです。src/data/selectors.json に追記してください。` +
          `登録済み: ${SELECTOR_IDS.join(" / ")}`,
      }),
      /** 必ず5冊。4冊でも6冊でもビルドを失敗させる */
      books: z.array(bookSchema).length(5),
    })
    .superRefine((data, ctx) => {
      // 下書きのあいだは未記入を許す。公開する（draft: false）ときだけ検証する
      if (data.draft) return;

      if (isPlaceholder(data.description)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["description"],
          message:
            "description が未記入です（TODO: のまま）。公開するなら書いてください",
        });
      }

      data.books.forEach((book, i) => {
        if (isPlaceholder(book.reason)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["books", i, "reason"],
            message: `${i + 1}冊目の選書理由が未記入です（TODO: のまま）`,
          });
        }
      });
    }),
});

export const collections = { interviews };
// `z.infer<…>` は astro:content の `z` が値としてのみ公開されていて
// 型名前空間として参照できないため、parse の戻り値から型を取り出す
export type Book = ReturnType<typeof bookSchema.parse>;
export type { Selector } from "./lib/selectors";
