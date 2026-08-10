/**
 * サイト全体の設定。
 *
 * ここ1箇所を書き換えれば全ページに反映されるようにしてある。
 * コード中にサイト名をハードコードしないこと。
 */
export const SITE = {
  /**
   * 表示名。**Skrinia（スクリニア）に確定**（2026-08-08）。
   * ラテン語 scrinium（巻物や書物を収める箱）から。
   * 経緯は .dev/business-plan.md の「サービス名」を参照。
   */
  name: "Skrinia",
  /** 本番の公開URL。OGPの絶対URL生成に使う */
  url: "https://book-media.pages.dev",
  description:
    "その領域に詳しい人が、その領域を学ぶための数冊を選んで紹介するメディアです。あまり知られていない良書も積極的に取り上げます。",
  /** 取材依頼・削除要請の窓口 */
  contactEmail: "skrinia.contact@gmail.com",
  /** 運営者のX（旧Twitter） */
  xUrl: "https://x.com/dokugaku_zin",
  /** 運営者のnote */
  noteUrl: "https://note.com/genkaidaigakuin",
  /** 運営者の個人サイト */
  ownerSiteUrl: "https://rmatsuba.com",
  /** 選者応募フォーム（外部サービス。未確定なので暫定） */
  applyFormUrl: "",
  /** メール登録フォーム（外部サービス。未確定なので暫定） */
  newsletterActionUrl: "",
  /**
   * Cloudflare Web Analytics のトークン。
   * 無料・Cookieless・同意バナー不要（requirements R9）。
   * Cloudflare のダッシュボードで取得して環境変数 PUBLIC_CF_BEACON_TOKEN に設定する。
   */
  analyticsToken: import.meta.env.PUBLIC_CF_BEACON_TOKEN ?? "",
} as const;

/** グローバルナビゲーション（design/SiteHeader.dc.html 準拠） */
export const NAV = [
  { label: "知る人ぞ知る本", href: "/hidden" },
  { label: "ジャンル一覧", href: "/topics" },
  { label: "選者一覧", href: "/selectors" },
  { label: "このサイトについて", href: "/about" },
] as const;

/** フッターのリンク（design/SiteFooter.dc.html 準拠） */
export const FOOTER_LINKS = [
  { label: "知る人ぞ知る本", href: "/hidden" },
  { label: "このサイトについて", href: "/about" },
  { label: "取材依頼・お問い合わせ", href: "/contact" },
  { label: "選者一覧", href: "/selectors" },
  { label: "プライバシーポリシー", href: "/privacy" },
] as const;

/** 書影・出典に関する注記（design/SiteFooter.dc.html の実文） */
export const FOOTER_NOTE =
  "掲載している書誌情報は各出版社の公開情報に基づきます。二次情報を扱う記事には出典元を明記しています。書影の掲載に関するご要望には速やかに対応します。";
