import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import topicsJson from "./data/topics.json";
import { isKnownSelector, SELECTOR_IDS } from "./lib/selectors";

/**
 * 1冊分の書誌情報と選書理由。
 * `whyUnknown`（この本が知られていない理由）は requirements R2c により必須。
 */
const bookSchema = z.object({
  title: z.string().min(1),
  author: z.string().min(1),
  translator: z.string().min(1).optional(),
  publisher: z.string().min(1),
  year: z.number().int(),
  /** ハイフンなしの13桁のみ。`978-4-…` 形式はビルドエラーにする */
  isbn: z.string().regex(/^\d{13}$/, "isbn は13桁の数字のみ（ハイフン不可）"),
  /** 選書理由 */
  reason: z.string().min(1),
  /** この本が知られていない理由（requirements R2c） */
  whyUnknown: z.string().min(1),
});

/**
 * テーマ（お題）は `src/data/topics.json` に定義した語彙のみ許可する。
 *
 * 自由入力にすると「行動経済学」「行動経済学入門」「行動経済学 」のように
 * 表記が揺れ、アーカイブページが乱立する。新しいお題を立てるときは
 * topics.json に追記する必要があり、**その一手間が抑止として機能する**。
 */
const TOPICS = topicsJson as string[];

const interviews = defineCollection({
  loader: glob({ base: "./src/content/interviews", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    title: z.string().min(1),
    slug: z.string().min(1),
    publishedAt: z.date(),
    /** 内容を直したときに入れる。JSON-LD の dateModified に使う */
    updatedAt: z.date().optional(),
    description: z.string().min(1),
    /** src/data/topics.json に定義された語彙のみ */
    topic: z.string().refine((value) => TOPICS.includes(value), {
      message:
        `未登録のテーマです。src/data/topics.json に追記してください。` +
        `登録済み: ${TOPICS.join(" / ")}`,
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
  }),
});

export const collections = { interviews };
// `z.infer<…>` は astro:content の `z` が値としてのみ公開されていて
// 型名前空間として参照できないため、parse の戻り値から型を取り出す
export type Book = ReturnType<typeof bookSchema.parse>;
export type { Selector } from "./lib/selectors";
