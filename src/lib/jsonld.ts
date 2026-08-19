/**
 * 構造化データ（JSON-LD）の生成。
 *
 * 記事1本につき `@graph` を1つ出力し、その中に
 *  - Article（著者 = 選者）
 *  - ItemList（紹介する Book。name / author / publisher / isbn）
 * を入れる。Google リッチリザルトテストの必須プロパティを満たすことを優先し、
 * 値が無い項目はプロパティごと落とす（空文字を出さない）。
 */
import { SITE } from "../config";

export type JsonLdBook = {
  title: string;
  author: string;
  translator?: string;
  publisher: string;
  year: number;
  /** ハイフンなし13桁 */
  isbn: string;
};

export type JsonLdSelector = {
  name: string;
  affiliation?: string;
  expertise?: string;
  bio?: string;
  links?: { x?: string; site?: string };
};

export type ArticleJsonLdInput = {
  title: string;
  description: string;
  /** 記事のパス or 絶対URL */
  url: string;
  /** OGP画像のパス or 絶対URL */
  image: string;
  publishedAt: Date;
  updatedAt?: Date;
  topic: string;
  keywords?: string[];
  selector: JsonLdSelector;
  books: JsonLdBook[];
};

/** 相対パスを SITE.url 基準の絶対URLにする */
export function absoluteUrl(pathOrUrl: string): string {
  return new URL(pathOrUrl, SITE.url).href;
}

function selectorSameAs(selector: JsonLdSelector): string[] {
  const urls: string[] = [];
  if (selector.links?.x) urls.push(`https://x.com/${selector.links.x}`);
  if (selector.links?.site) urls.push(selector.links.site);
  return urls;
}

/** 選者を Person として表す（Article.author と Book.reviewedBy 相当の共通部品） */
function personNode(selector: JsonLdSelector) {
  const sameAs = selectorSameAs(selector);
  return {
    "@type": "Person",
    name: selector.name,
    // 所属は任意。無い選者に空の Organization を出すと、
    // 構造化データとしては「所属不明の組織がある」ことになってしまう
    ...(selector.affiliation
      ? {
          affiliation: {
            "@type": "Organization",
            name: selector.affiliation,
          },
        }
      : {}),
    // 専門・関心領域は knowsAbout（Person の「詳しい主題」）に載せる。
    // description（略歴）とは別物なので、片方が空でももう片方は出す
    ...(selector.expertise ? { knowsAbout: selector.expertise } : {}),
    ...(selector.bio ? { description: selector.bio } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

/**
 * 1冊分の Book ノード。
 * Book は name / author が必須、isbn / publisher は推奨。
 * 翻訳者がいる場合は translator を足す。
 */
function bookNode(book: JsonLdBook) {
  return {
    "@type": "Book",
    name: book.title,
    author: { "@type": "Person", name: book.author },
    publisher: { "@type": "Organization", name: book.publisher },
    isbn: book.isbn,
    datePublished: String(book.year),
    ...(book.translator
      ? { translator: { "@type": "Person", name: book.translator } }
      : {}),
    inLanguage: "ja",
    // 注: workExample / potentialAction（Book Actions）は購入・貸出URLを持つ
    // サイトのための拡張。URLを持たない状態で出すとリッチリザルトテストで
    // エラーになるため、意図的に出力しない。
  };
}

/** 記事ページに埋め込む JSON-LD（@graph）を返す */
export function articleJsonLd(input: ArticleJsonLdInput) {
  const url = absoluteUrl(input.url);
  const image = absoluteUrl(input.image);
  const author = personNode(input.selector);

  const article = {
    "@type": "Article",
    "@id": `${url}#article`,
    headline: input.title,
    description: input.description,
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    image: [image],
    datePublished: input.publishedAt.toISOString(),
    dateModified: (input.updatedAt ?? input.publishedAt).toISOString(),
    author,
    publisher: {
      "@type": "Organization",
      name: SITE.name,
      url: absoluteUrl("/"),
    },
    about: { "@type": "Thing", name: input.topic },
    inLanguage: "ja",
    isAccessibleForFree: true,
    ...(input.keywords && input.keywords.length > 0
      ? { keywords: input.keywords.join(", ") }
      : {}),
  };

  const itemList = {
    "@type": "ItemList",
    "@id": `${url}#books`,
    name: input.title,
    description: `${input.selector.name}が選ぶ${input.topic}の${input.books.length}冊`,
    numberOfItems: input.books.length,
    itemListOrder: "https://schema.org/ItemListOrderAscending",
    itemListElement: input.books.map((book, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: bookNode(book),
    })),
  };

  // パンくず。検索結果に「サイト名 > テーマ > 記事」の階層が出るようになる。
  // 記事が増えてテーマページが検索の受け皿になったとき、
  // 記事とテーマの関係を検索エンジンに明示できる
  const breadcrumb = {
    "@type": "BreadcrumbList",
    "@id": `${url}#breadcrumb`,
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: SITE.name,
        item: absoluteUrl("/"),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: input.topic,
        item: absoluteUrl(`/topics/${encodeURIComponent(input.topic)}/`),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: input.title,
        item: url,
      },
    ],
  };

  return {
    "@context": "https://schema.org",
    "@graph": [article, itemList, breadcrumb],
  };
}

/** サイト全体（トップページ用）の JSON-LD */
export function websiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE.name,
    url: absoluteUrl("/"),
    description: SITE.description,
    inLanguage: "ja",
  };
}

/** `<script type="application/ld+json">` に安全に埋めるための文字列化 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
