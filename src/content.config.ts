import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

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
 * 選者。`credentials`（公開された実績）は business-plan.md の選者資格基準により必須。
 */
const selectorSchema = z.object({
  name: z.string().min(1),
  reading: z.string().min(1).optional(),
  affiliation: z.string().min(1),
  bio: z.string().min(1),
  /** 公開された実績・その領域に詳しい根拠 */
  credentials: z.string().min(1),
  links: z
    .object({
      x: z.string().optional(),
      site: z.string().optional(),
    })
    .optional(),
});

const interviews = defineCollection({
  loader: glob({ base: "./src/content/interviews", pattern: "**/*.{md,mdx}" }),
  schema: z.object({
    title: z.string().min(1),
    slug: z.string().min(1),
    publishedAt: z.date(),
    description: z.string().min(1),
    topic: z.string().min(1),
    keywords: z.array(z.string()).optional(),
    selector: selectorSchema,
    /** 必ず5冊。4冊でも6冊でもビルドを失敗させる */
    books: z.array(bookSchema).length(5),
  }),
});

export const collections = { interviews };
export type Book = z.infer<typeof bookSchema>;
export type Selector = z.infer<typeof selectorSchema>;
