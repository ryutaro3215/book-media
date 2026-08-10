import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";
import { isKnownSelector, SELECTOR_IDS } from "./lib/selectors";
import { isKnownTag, TAG_NAMES } from "./lib/tags";
import {
  getSubtopics,
  isKnownSubtopic,
  isKnownTopic,
  TOPIC_NAMES,
} from "./lib/topics";

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
  /**
   * **この1冊を「いちばんよかった」として選んだ理由**。
   *
   * 書くとその本に「知る人ぞ知る本」の印が付き、`/hidden` に集まる。
   *
   * **書けるのは1記事に1冊だけ。公開する記事には必ず1冊必要**
   * （`draft: false` で検証する。下書きのあいだは無くてよい）。
   * 型としては optional にしてあるが、これは「印の付かない本には
   * この項目自体が無い」ためで、記事単位では必須。
   *
   * ## なぜ1記事に1冊なのか
   * 以前は全冊に「知られていない理由」を必須にしていたが、
   * 1本目の記事が定番書ばかりで**書けずに詰まった**ため撤回した経緯がある。
   * 全冊に課すと書ける記事が極端に狭まる。
   *
   * 一方で「良い本を広めたい、埋もれた本を発掘したい」という動機は
   * このメディアの出発点であり、記事に落ちる経路が必要だった。
   * **記事は定番でよい。そのうち1冊だけ印を付ける**なら、負担はほぼゼロで、
   * 印が溜まれば分野を横断した資産（`/hidden`）になる。
   *
   * ## なぜ任意をやめたのか（2026-08-10）
   * 任意にしていたら、応募でも記事でも**書かれないまま流れる**。
   * `/hidden` はこのメディアの核なので、集まらないと成立しない。
   * 「挙げた中でいちばんよかった1冊」は選者が必ず答えられる問いなので、
   * 必須にしても負担にならないと判断した。
   *
   * 判定は**選者本人の主観**でよい。知名度は選者にも答えにくいので、
   * 聞くのは「挙げた中でいちばんよかった1冊はどれですか」。
   * そのうえで、迷ったらあまり知られていない本を選んでほしいと**お願い**する
   * （条件ではない）。答えやすい問いにしつつ、拾いたい本が集まるようにしている。
   */
  bestReason: z.string().min(1).optional(),
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
       * 記事タイトルは「〈選者〉が選ぶ、〈テーマ〉のN冊」のような形で、
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
      /**
       * **大トピック**（必須・1つ）。例: 数学 / 経営学
       * `/topics/<名前>/` のページが生成される。
       * より細かい分野は `subtopic`、さらに細かいものは `tags` に入れる
       */
      topic: z.string().refine(isKnownTopic, {
        message:
          `未登録のテーマです。src/data/topics.json に追記してください。` +
          `登録済み: ${TOPIC_NAMES.join(" / ")}`,
      }),
      /**
       * **小トピック**（任意・1つ）。例: 解析学 / 統計学 / 経営戦略論
       *
       * **その大トピックに属する語彙のみ**（`topics.json` の subtopics）。
       * 「天体物理学」のように大トピックをまたいで同名が存在するため、
       * 全体で一意ではなく、`topic` との組で検証する（下の superRefine）。
       *
       * **ページは作らない。** 記事が少ないうちは1記事しか無いページが
       * 量産され、薄いページはインデックスされない。検索で引ければ足りる。
       */
      subtopic: z.string().optional(),
      /**
       * **タグ**（任意・複数）。例: 多変量解析 / 作用素環論
       *
       * 小トピックより細かいもの。src/data/tags.json の語彙のみ（表記揺れ防止）。
       * 小トピックと同じくページは作らず、検索へのリンクとして扱う。
       */
      tags: z
        .array(
          z.string().refine(isKnownTag, {
            message:
              `未登録のタグです。src/data/tags.json に追記してください。` +
              `登録済み: ${TAG_NAMES.join(" / ")}`,
          }),
        )
        .optional(),
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
      /**
       * 3冊以上。上限は設けない。2冊以下はビルドを失敗させる。
       *
       * 以前は `.length(5)`（5冊ちょうど）だった。5冊固定をやめた経緯と
       * そのトレードオフは `.dev/business-plan.md`（2026-08-05）に記録してある。
       */
      books: z
        .array(bookSchema)
        .min(3, "books は3冊以上にしてください（2冊以下は公開できません）"),
    })
    .superRefine((data, ctx) => {
      // 小トピックは「その大トピックに属するか」で検証する。
      // 全体では重複しうる（天体物理学は物理学にも天文学にもある）ため、
      // topic との組でなければ判定できない。下書きでも検証する
      if (data.subtopic && !isKnownSubtopic(data.topic, data.subtopic)) {
        const candidates = getSubtopics(data.topic);
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["subtopic"],
          message:
            `「${data.subtopic}」は大トピック「${data.topic}」の小トピックではありません。` +
            (candidates.length > 0
              ? `候補: ${candidates.slice(0, 12).join(" / ")}${candidates.length > 12 ? " …" : ""}`
              : ""),
        });
      }

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
        if (book.bestReason && isPlaceholder(book.bestReason)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["books", i, "bestReason"],
            message: `${i + 1}冊目の「この1冊を選んだ理由」が未記入です（TODO: のまま）`,
          });
        }
      });

      // 「いちばんよかった1冊」は公開する記事には必ず1冊。
      // 任意にしていたら書かれないまま流れ、`/hidden` が育たない
      const marked = data.books.filter((book) => book.bestReason).length;
      if (marked === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["books"],
          message:
            "「いちばんよかった1冊」が選ばれていません。1冊に bestReason を書いてください（公開する記事には必ず1冊必要）",
        });
      } else if (marked > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["books"],
          message: `「いちばんよかった1冊」は1冊だけです（いま ${marked} 冊に bestReason が付いています）`,
        });
      }
    }),
});

export const collections = { interviews };
// `z.infer<…>` は astro:content の `z` が値としてのみ公開されていて
// 型名前空間として参照できないため、parse の戻り値から型を取り出す
export type Book = ReturnType<typeof bookSchema.parse>;
export type { Selector } from "./lib/selectors";
