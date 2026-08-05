# Plan — fivebooks（仮称・名称選定中）
status: approved
updated: 2026-08-04
stack: Astro（Content Collections + MDX）/ TypeScript / Zod / **Tailwind CSS v4**（`@tailwindcss/vite`。CSS-firstの `@theme` でデザイントークンを定義）/ Satori + resvg-js（OGP画像のビルド時生成）/ Cloudflare Pages（ホスティング）/ Cloudflare Web Analytics
inputs: business-plan.md (approved) / requirements.md (approved) / design-brief.md (approved)

## 技術選定の記録

- **Astro**: ユーザー承認済み（比較提示 → 選択）。Content Collections の Zod スキーマ検証が「5冊固定の構造化frontmatter」という要件に直撃で応えるため
- **Cloudflare Pages**: 選択の余地なし。Vercel Hobby と GitHub Pages は**規約で商用利用を禁止**しており、business-plan.md の「将来収益手段を探す」方針と両立しない
- **Tailwind CSS v4**: ユーザー指定（2026-08-04）。当初は素のCSSを想定していたが、利用技術に制限がないため変更した
  - **v4 の CSS-first 設定（`@theme`）で design-brief.md のトークンを一元定義する。** 配色・行間・カラム幅を Tailwind のテーマトークンとして宣言し、**コンポーネント側では任意値（`text-[#2F4A3F]` のような直書き）を使わない**。これによりトークンからの逸脱をレビューで検出できる
  - `@apply` の多用は避け、繰り返しはAstroコンポーネントとして切り出す
  - Claude Design のエクスポートHTMLがTailwindでない記法で来た場合、実装時にトークンへ置き換える（`design/` のHTMLは見た目の正であって、記法の正ではない）
- **書影のフォールバック実装方針**: design-brief.md では「ビルド時に生成した文字組みの面」としていたが、**ページ内表示はCSSコンポーネントで実装する**（画像生成より軽く、レスポンシブに追随し、テキストが選択・検索可能になるため）。Satori は OGP画像の生成にのみ使う

## external_skills

- **dev-design**: design-brief.md の所有者。デザイン変更時は本skillでブリーフを更新してから実装に反映する（T4/T6/T7/T8 に関連）
- **fixing-accessibility**: T11 のアクセシビリティ検証で使用。見出し階層・コントラスト比・キーボード操作の監査
- **baseline-ui**: T3・T4・T6・T7 で使用。Tailwind プロジェクトのタイポグラフィスケール強制・レイアウトのアンチパターン検出・コンポーネントのアクセシビリティ検査に使う。**design-brief.md の指定と競合した場合は design-brief.md を優先する**（本プロジェクトは行間1.9・カラム660pxという固有の値を意図的に採用しているため）
- **frontend-design**: T3 で使用可。デザイントークンを落とす際の指針として参照する（design-brief.md の指定が優先）
- **dev-security**: リリース前の監査（plan外・リリースゲート）
- **dev-docs**: README・セットアップ手順の作成（plan外・リリース後でよい）

---

## T1: Astro プロジェクト初期化と Cloudflare Pages への疎通
- goal: 空のAstroサイトが Cloudflare Pages 上で表示され、以降のタスクがデプロイ結果を確認できる状態にする
- files: `package.json` / `astro.config.mjs` / `tsconfig.json` / `src/pages/index.astro` / `.gitignore`
- acceptance:
  - `npm run build` が成功し、`dist/index.html` が生成される
  - `npm run preview` でローカルにアクセスすると、プレースホルダのテキストが表示される
  - `.gitignore` に `node_modules` と `.env*` が含まれている（`grep -E "node_modules|\.env" .gitignore` が両方にヒットする）
  - Cloudflare Pages にデプロイされ、公開URLで同じページが表示される
- depends: なし
- skills: なし

## T2: Content Collections のスキーマ定義とサンプル記事
- goal: 記事のfrontmatterをZodで型検証し、冊数の下限をビルド時に強制する（当初は「必ず5冊」。T22で3冊以上へ緩和）
- files: `src/content.config.ts` / `src/content/interviews/sample-yamada.md` / `src/content/interviews/sample-sato.md`
- acceptance:
  - スキーマに `books: z.array(bookSchema).length(5)` が定義されている
  - `isbn` が `z.string().regex(/^\d{13}$/)` で13桁数字のみに制約されている（ハイフンありはビルドエラー）
  - 選者情報に `name` / `affiliation` / `bio` / `links.x`（任意）が定義されている
  - 選者情報に **`credentials`（この人が詳しい理由）が必須項目**として定義されている（business-plan.md の選者資格基準）
  - サンプル記事2本が5冊ずつ持ち、`npm run build` が成功する（T22以降は3冊以上であればよい）
  - **意図的に4冊にしたテスト用ファイルを一時的に置くと `npm run build` が失敗する**ことを確認できる（確認後にファイルは削除する）
- depends: T1
- skills: なし

## T3: Tailwind の導入とデザイントークンの定義、Webフォントのセルフホスト
- goal: design-brief.md の全トークンを Tailwind のテーマトークンとして定義し、以降のコンポーネントが任意値を直書きしない状態にする
- files: `src/styles/global.css`（`@import "tailwindcss"` と `@theme`）/ `astro.config.mjs`（`@tailwindcss/vite` の追加）/ `src/layouts/BaseLayout.astro` / `public/fonts/`（Zen Kaku Gothic New のサブセット）
- acceptance:
  - `@theme` に design-brief.md の5色が意味のある名前で定義されている（例: `--color-ink` `--color-muted` `--color-rule` `--color-accent`）。**HEX値がコンポーネント側に直接現れない**
  - 本文の行間 `1.9`、本文カラム `660px`、本文サイズ（モバイル16px・デスクトップ17px）が `@theme` のトークンとして定義されている
  - Zen Kaku Gothic New が `public/fonts/` から `@font-face` でセルフホストされ、外部CDNへのリクエストが発生しない（`grep -r "gstatic\|googleapis" dist/` が0件）
  - `npm run build` が成功し、生成CSSにトークンが反映されている
- depends: T1
- skills: baseline-ui, frontend-design（いずれも参考。design-brief.md が優先）

## T4: 書籍カードコンポーネント（書影あり／なしの両対応）
- goal: 書影がある書籍とない書籍が縦に並んでも、統一されたグリッドとして成立するカードを実装する
- files: `src/components/BookCard.astro` / `src/components/BookCover.astro`
- acceptance:
  - `BookCover.astro` が、書影URLがある場合は画像を、ない場合は**書名を組んだ文字だけの面**を、**同一の高さの枠**で描画する
  - 書影がない場合の表示に、グレーの塗りつぶし・「No Image」等の文字列が**含まれていない**（`grep -ri "no image\|noimage" src/` が0件）
  - 書影あり2冊・なし3冊を混在させたテストページで、5枚のカードの枠の高さが一致している（開発者ツールで確認できる）
  - 見た目が `design/book-card.html` と一致している
  - カード番号（01〜05）が表示される
  - **Tailwind の任意値記法（`[...]`）が使われていない**（`grep -E "\[#|\[[0-9]+px\]" src/components/BookCard.astro src/components/BookCover.astro` が0件）。すべてT3で定義したトークン経由であること
- depends: T3
- skills: dev-design（デザイン変更時はブリーフを先に更新）, baseline-ui

## T5: 書影の解決ロジック
- goal: ISBNから書影を解決し、取得できない場合にフォールバックへ倒す仕組みをビルド時に確定させる
- files: `src/lib/cover.ts` / `src/lib/openbd.ts` / `public/covers/`（自前で用意した画像の置き場）
- acceptance:
  - 解決の優先順位が「①`public/covers/<isbn>.jpg` が存在すればそれを使う → ②openBD API → ③Google Books API → ④フォールバック（文字組み）」の順で実装されている
  - ビルド時に解決し、実行時にAPIを呼ばない（ビルド後の `dist/` 内のJSにAPI呼び出しが含まれない）
  - APIが応答しない・タイムアウトした場合でも**ビルドが失敗せず**、フォールバックに倒れる（ネットワークを遮断して `npm run build` が成功することで確認）
  - 各書籍の解決結果（どの経路で取得したか）がビルドログに出力され、フォールバック件数が集計される
  - **注**: 自前で用意した画像の配信は複製・公衆送信にあたる（requirements.md の8参照）。運用として出版社の許諾取得・出典表記・削除要請への即応が前提であることを `docs/covers.md` に明記する
- depends: T2
- skills: なし

## T6: 記事ページ
- goal: 記事1本を最後まで読み通せる品質で表示する（本プロジェクトの中核）
- files: `src/pages/[slug].astro` / `src/components/ArticleHeader.astro` / `src/components/SelectorProfile.astro`
- acceptance:
  - サンプル記事にアクセスすると、記事ヘッダー → 導入文 → 書籍カード → まとめ → メール登録フォーム → フッターの順で表示される
  - 選者名・所属に加え、**Xアカウントへのリンク**が表示され、`https://x.com/<handle>` に遷移する（requirements R2a）
  - 本文カラムの実効幅が660px以下、`line-height` が1.9であることを開発者ツールで確認できる
  - アクセント色のトークン（`accent`）がリンクとメール登録ボタン以外に使われていない（`grep -rn "accent" src/` の該当箇所がリンク・ボタンのみ）
  - **Tailwind の任意値記法（`[...]`）が `src/` 全体で使われていない**（`grep -rE "\[#|\[[0-9]+px\]" src/` が0件）
  - 二次情報を扱う記事で出典元とリンクが表示される（requirements R6）
  - 見た目・セクション構成が `design/article.html` と一致している
  - モバイル幅（375px）で横スクロールが発生しない
- depends: T4, T5
- skills: dev-design, baseline-ui

## T7: トップページ（記事一覧）
- goal: 訪問者が記事を見つけて1本目を開ける状態にする
- files: `src/pages/index.astro` / `src/components/ArticleListItem.astro`
- acceptance:
  - 全記事が公開日の新しい順に**縦一列のリスト**で表示される（カードグリッドではない）
  - 各項目に「分野名 / 記事タイトル / 選者名・所属 / 公開日」が表示される
  - **キャッチコピー・ヒーローセクションが存在しない**（marketing-plan.md 未確定のためコピーを創作しない）
  - 見た目が `design/index.html` と一致している
- depends: T6
- skills: dev-design, baseline-ui

## T8: OGP画像のビルド時生成
- goal: 記事ごとに固有のOGP画像を静的生成し、Xでの共有時に選者名が読める状態にする（成功指標「X共有率50%」に直結）
- files: `src/pages/og/[slug].png.ts` / `src/lib/og-template.tsx` / `public/fonts/`（Satori用フォント）
- acceptance:
  - `npm run build` 後、`dist/og/` に記事数と同数のPNGが1200×630pxで生成されている（`ls dist/og/*.png | wc -l` が記事数と一致）
  - 生成された画像に選者名・分野名・冊数が含まれ、**画像を50%（600×315px）に縮小しても選者名と分野名が判読できる**
  - 日本語が文字化けせずに描画されている（フォントのサブセット読み込みが機能している）
  - 書影を使用していない（書影の取得可否に依存しない）
  - 要素数が5つ以内
- depends: T3
- skills: dev-design

## T9: メタタグ・構造化データ・sitemap
- goal: X共有時にカードが正しく表示され、検索流入の土台を作る
- files: `src/components/SEO.astro` / `src/lib/jsonld.ts` / `astro.config.mjs`（sitemap統合）
- acceptance:
  - 各記事ページに `og:title` / `og:description` / `og:image`（**絶対URL**）/ `twitter:card="summary_large_image"` が出力される
  - `og:image` が T8 で生成した該当記事のPNGを指している
  - `ItemList` + `Book` の JSON-LD が出力され、[Google リッチリザルトテスト](https://search.google.com/test/rich-results) でエラーが出ない
  - `dist/sitemap-index.xml` が生成され、全記事URLが含まれている
  - **X Card Validator で実際にカードが表示されることを確認する**（デプロイ後。画像を後から差し替えても反映されないため、公開前に必ず通す）
- depends: T8
- skills: なし

## T10: メール登録フォームとアクセス解析
- goal: business-plan.md の成功指標「メール登録300人」「訪問者数」を計測可能にする
- files: `src/components/NewsletterForm.astro` / `src/layouts/BaseLayout.astro`
- acceptance:
  - 記事末尾に外部メール配信サービス（Buttondown等）の登録フォームが表示され、実際に登録できる（テストアドレスで1件登録し、サービス側の管理画面に反映されることを確認）
  - フォームは**入力欄1つとボタン1つのみ**（名前欄等を追加しない）
  - **自前のサーバー・DBにメールアドレスを保存していない**（フォームのPOST先が外部サービスのドメインである）
  - Cloudflare Web Analytics のスクリプトが全ページに読み込まれ、デプロイ後にダッシュボードでPVが確認できる
  - Cookie を使用していない（開発者ツールのApplicationタブでCookieが0件）
- depends: T6
- skills: なし

## T11: アクセシビリティ・パフォーマンス検証
- goal: requirements.md の非機能要件を満たしていることを数値で確認する
- files: （検証のみ。修正が必要な場合は該当ファイル）
- acceptance:
  - Lighthouse（モバイル）で Performance 90以上、Accessibility 95以上、SEO 95以上
  - 見出し階層に飛びがない（h1 → h3 のような飛びがない）
  - 本文と背景のコントラスト比が 4.5:1 以上（`#292929` on `#FFFFFF` = 約13.9:1 で満たす。副次テキスト `#787878` on `#FFFFFF` = 約4.6:1 を実測で確認する）
  - 全ての書影画像に意味のある `alt` が設定されている（書名を含む）
  - キーボードのみで全リンク・フォームを操作でき、フォーカスリングが視認できる
  - `npm audit` で high 以上の脆弱性が0件
- depends: T7, T9, T10, T12, T13, T14, T15
- skills: fixing-accessibility

## T12: 文書ページ共通テンプレートと固定ページ
- goal: 「このサイトについて」等の静的ページを1つのテンプレートで提供する。**取材依頼の成否を左右するページ群**
- files: `src/layouts/DocumentLayout.astro` / `src/pages/about.md` / `src/pages/contact.md` / `src/pages/privacy.md` / `src/pages/404.astro`
- acceptance:
  - `/about` `/contact` `/privacy` にアクセスすると、記事ページと同一の本文組版（カラム660px以下・行間1.9）で表示される
  - `/about` に運営者の氏名・所属・経歴・連絡先へのリンクが含まれている（requirements R10）
  - `/contact` に**取材依頼の受け口**と**書影・引用に関する削除要請の窓口**の両方が記載され、メールアドレスが静的に掲載されている（フォームを実装していない）
  - `/privacy` にアクセス解析（Cloudflare Web Analytics）とメール登録（外部サービス）における個人情報の扱い、書影・書誌データの出典と削除要請の方針が記載されている（requirements R14）
  - 存在しないURLにアクセスすると404ページが表示され、トップへのリンクがある
  - 全ページのフッターから `/about` `/contact` `/privacy` に到達できる
  - 見た目が `design/document.html` と一致している
- depends: T3
- skills: dev-design, baseline-ui

## T13: 選者一覧・選者個別ページ
- goal: 「誰が薦めたか」を人単位で辿れるようにする
- files: `src/pages/selectors/index.astro` / `src/pages/selectors/[id].astro` / `src/components/SelectorCard.astro`
- acceptance:
  - `/selectors` に全選者が縦一列のリストで表示され、各項目に氏名・所属・専門分野・記事数がある
  - `/selectors/<id>` に選者のプロフィールとその選者の記事一覧が表示される
  - **顔写真がない選者を含めてもレイアウトが崩れない**（写真あり1名・なし2名のテストデータで確認）
  - XアカウントのリンクがあるとXへ遷移し、ない選者ではリンク自体が表示されない
  - 記事ページの選者名から該当する選者ページに遷移できる
  - 見た目が `design/selectors.html` と一致している
- depends: T6
- skills: dev-design, baseline-ui

## T14: 分野別アーカイブ
- goal: 「〇〇 入門書」等の検索流入の受け皿を作る
- files: `src/pages/topics/index.astro` / `src/pages/topics/[topic].astro`
- acceptance:
  - `/topics/<topic>` にその分野の記事がトップページと同一のリスト形式で表示される
  - 記事ページの分野名から該当する分野ページに遷移できる
  - **分野の説明文が創作されていない**（marketing-plan.md 未確定のため）
  - 各分野ページに固有の `title` と `description` が出力され、sitemap に含まれている
  - 記事が1本しかない分野でもレイアウトが成立する
  - 見た目が `design/topic.html` と一致している
- depends: T7, T9
- skills: dev-design, baseline-ui

## T15: 選者応募ページ
- goal: 「自分で選書したい人」の応募経路を作る。取材獲得の第2の導線（成功指標「一次取材10本」の律速を緩和する）
- files: `src/pages/apply.astro`
- acceptance:
  - `/apply` に応募の説明・応募いただく内容の項目一覧・外部フォームへの導線が表示される
  - 応募項目に「氏名 / 所属 / 専門分野 / Xアカウント（任意）/ 推薦する本（3冊以上）（書名・著者・出版社）/ 各冊の選書理由」が明示されている（requirements R16a）
  - **「掲載を確約しない」旨が本文中に記載されている**（requirements R16b）
  - 外部フォームサービス（Tally / Google Forms 等）が埋め込まれている、または外部フォームへのボタンが1つある
  - **フォームを自前実装していない**（`src/` に `<form>` の `action` が自サイト内を指す実装が存在しない）
  - CTAが1つだけである
  - 記事ページ末尾とフッターから `/apply` に到達できる
  - 見た目が `design/apply.html` と一致している
- depends: T12
- skills: dev-design, baseline-ui

## T16: サイト内検索（クライアントサイド）
- goal: ヘッダーの検索フォームから、分野・選者・書名で記事を絞り込めるようにする（requirements R17）
- files: `src/pages/search.astro` / `src/pages/search-index.json.ts`
- acceptance:
  - `npm run build` 後、`dist/search-index.json` が生成され、全記事の「タイトル・分野・選者名・書名」が含まれている
  - `/search?q=<語>` にアクセスすると、該当する記事がリスト表示される
  - **サーバーサイド処理・外部検索サービスを使っていない**（`dist/` に出力されるのは静的JSONとJSのみ）
  - 検索語が空・該当なしの場合に、それぞれ適切な表示になる
  - JavaScript が無効でも、ページ自体は表示され全記事一覧が見える（プログレッシブエンハンスメント）
  - 見た目が `design/SearchResults.dc.html` と一致している
- depends: T7
- skills: dev-design

## T17: Xへの共有ボタン
- goal: 記事を X に共有する摩擦を下げる。**選者本人が共有したくなる状態**を作る（成功指標「X共有率50%」に直結）
- files: `src/components/ShareToX.astro` / `src/pages/[slug].astro`
- acceptance:
  - 記事ページに共有ボタンがあり、押すと X の投稿画面が**別タブで開く**
  - 投稿画面に「記事タイトル・選者名・記事の絶対URL」が**事前入力されている**
  - **外部スクリプトを読み込んでいない**（`grep -r "platform.twitter.com\|widgets.js" src/ dist/` が0件）。intent URL のみで実装する
  - 共有ボタンが**記事末尾の1箇所だけ**にある（requirements R18b）
  - URL が `SITE.url` を基準にした絶対URLである（相対パスだと共有先で壊れる）
  - ボタンにアクセント色を使っていない（アクセントはリンクとメール登録ボタンのみ。design-brief.md の制約）
- depends: T6
- skills: dev-design

## T18: スマートフォン対応
- goal: モバイルで全ページが破綻せず、**すべてのページに到達できる**状態にする
- 背景: requirements R7「スマートフォンで読みやすい表示」は当初から要件だが、**実測していない**。
  design/ にモバイル版の指定がなかったため、ナビゲーションは単に非表示にする実装になっている。
  **Xからの流入が主要導線であり読者の大半がモバイル**なので、事業上の優先度は高い
- files: `src/components/SiteHeader.astro` / `src/components/MobileNav.astro`（新規）/ 各ページ
- acceptance:
  - **375px 幅でグローバルナビ（ジャンル一覧・選者一覧・このサイトについて）に到達できる**
    （現状はヘッダーの nav が `md:flex` で消え、フッターのリンクだけが手段になっている）
  - 375px / 390px / 768px で**横スクロールが発生しない**（全ページ。DevTools で実測する）
  - 検索フォームがモバイルでも使える（プレースホルダが読める、またはアイコンのみに畳む）
  - 書籍カードが折り返したときに、書影と書誌の位置関係が破綻していない
  - 記事本文の行長がモバイルで詰まりすぎていない（`px-5` の余白を含めて確認）
  - タップ領域が 44×44px 以上（リンク・ボタン）
  - **実機またはDevToolsのデバイスモードで全ページを目視確認した記録を残す**
- depends: T7, T12, T13, T14
- skills: dev-design, baseline-ui, fixing-accessibility

## T19: Google検索への対応（土台の整備）
- goal: **検索エンジンに正しくクロール・インデックスされる状態**を作る
- 前提: メタタグ・JSON-LD・sitemap・見出し階層・モバイル対応は **T9/T11/T18 で実装済み**。
  ここでやるのは残りの土台整備と、外部サービスへの登録・検証
- **重要な判断**: 記事が実質1本の段階で、コンテンツSEO（キーワード設計・内部リンク最適化）
  に投資しても効果は出ない。**検索流入は記事の蓄積が前提**であり、いま必要なのは
  「記事が増えたときに正しく拾われる状態」を先に作っておくことだけ。
  ここに時間をかけすぎない
- files: `public/robots.txt` / `src/lib/jsonld.ts` / `src/components/SEO.astro`
- acceptance:
  - **`public/robots.txt` が存在し、sitemap の場所を示している**（現状は未作成）
  - **BreadcrumbList の JSON-LD** を記事ページに出力する（トップ → テーマ → 記事の階層。
    検索結果にパンくずが出るようになる）
  - **Google リッチリザルトテストでエラーが0件**（`search.google.com/test/rich-results`）
  - **Google Search Console にサイトを登録し、sitemap を送信した**
    （※これをやらないと、インデックス状況もクエリも一切測定できない。
      個人サイトは放置すると数週間インデックスされないため、送信が最速）
  - URL の末尾スラッシュが全ページで統一されている（sitemap・canonical・内部リンクの3者が一致）
  - Lighthouse の SEO スコアが95以上
- depends: T9, T18
- skills: なし

## T20: 記事サムネイルを書影で作る
- goal: トップページの記事カードを、その記事で紹介する**本の表紙を並べた見た目**にする
- 背景: 現在は OGP画像（選者名が大きく入った画像）を流用している。
  本の記事なのに**本が写っていない**ため、一覧の情報量が乏しい
- **実装方針の判断が必要（先に決めること）**:
  - **案A（推奨）: 画像を生成せず、CSS で5枚を並べる**
    - 書影カードと同じく外部URLを**参照するだけ**なので、権利上の扱いが変わらない
    - 書影が無い本が混ざっても、縦組みフォールバックをそのまま並べれば成立する
    - 実装が軽い（コンポーネントのみ。ビルド時間も増えない）
  - **案B: 5冊を1枚に合成した画像を生成する**
    - **合成して自前配信することは複製・公衆送信にあたる**（docs/covers.md の整理と同じ論点）。
      外部URLの参照とは法的な扱いが異なる
    - Google Books のサムネイルは横128px程度で、並べると粗い
    - OGP画像にも使いたい場合はこちらが必要（OGPは実ファイルが要るため）
- acceptance:
  - トップページの記事カードに、その記事の5冊の表紙が並んで表示される
  - **書影が取得できない本が混ざってもレイアウトが破綻しない**（縦組みフォールバックで埋まる）
  - `public/thumbnails/<slug>.jpg` が置かれている場合は、そちらを優先する（既存仕様を壊さない）
  - 案Bを採る場合は、`docs/covers.md` に合成物の扱いを追記する
- depends: T7
- skills: dev-design

## T21: 書誌の取得は Google Books を基本にする
- goal: 自動取得される書誌の精度を上げ、手直しを減らす
- 背景: 現在は**書名を openBD 優先**にしているが、実際に誤りが出た。
  1本目の記事で `共立講座数学の魅力. 11`（叢書名）が入り、
  正しい `現代数理統計学の基礎` は Google Books 側が返していた
- **ただし「Google Books を全面的に主軸」にはできない**。実測（12冊）:

  | 項目 | openBD | Google Books |
  |---|---|---|
  | 書名 | 10/10（ただし叢書名・volume・副題が混ざる） | 8/10（**表示用として正確**） |
  | 著者 | 図書館形式（`Locke,John,1632-1704`） | **表示用の形（`ジョン・ロック`）** |
  | **出版社** | **10/10** | **0/10（返さない）** |
  | 刊行年 | 10/10 | 8/10 |

  **Google Books は出版社を一切返さない。** 全面的に切り替えると出版社が毎回手入力になる
- acceptance:
  - **書名**: Google Books を優先し、取れなければ openBD にフォールバックする
  - **著者**: Google Books を優先（現状どおり）
  - **出版社**: openBD のみ（Google Books は返さないため）
  - **刊行年**: どちらか取れた方。**食い違う場合は要確認コメントに出す**（現状どおり）
  - `scripts/check-isbn.mjs` の出力にも新しい優先順位を反映する
  - 実際のISBNで、1本目の記事で起きた `共立講座数学の魅力. 11` が
    `現代数理統計学の基礎` として取得されることを確認する
- depends: なし
- skills: なし


## T22: 本の冊数を「5冊ちょうど」から「3冊以上」に変える
- goal: 記事に載せる本の冊数を可変（3冊以上・上限なし）にし、表示・OGP・CLI・文書の
  「5冊」という固定表記をすべて実際の冊数から生成する形にする
- 背景: 5冊固定は選者に「ちょうど5冊ひねり出す」ことを要求し、**記事が出ないリスク**を高める。
  事業判断としてこれを優先した。**その代わりに識別子としての固定形式を失う**——
  この論点（Five Books が17年守る商品性であること）はオーナーへ伝達済みで、
  そのうえでの決定。詳細は `.dev/business-plan.md`【コンセプト変更の履歴】2026-08-05 第3回
- acceptance:
  - `src/content.config.ts` の `books` が `z.array(bookSchema).min(3, …)` になっている
    （エラーメッセージは「3冊以上にしてください」）
  - 記事ページの目次見出しが実際の冊数（例「この記事で紹介する4冊」）になる
  - OGP画像のメタ行の「5冊」が実際の冊数になる
  - `src/lib/jsonld.ts` の ItemList description が実際の冊数になる
  - `scripts/new-article.mjs` が**冊数を先に聞き**（3以上・既定5）、その冊数ぶん ISBN を聞き、
    タイトル雛形もその冊数に合わせる
  - 3冊の記事でビルドが通り、2冊の記事でビルドが失敗する（実地確認）
  - `grep -rn "5冊" src/ scripts/` に固定値として残っているものがない
  - requirements.md / README.md / business-plan.md（失うものの記録を含む）が更新されている
- 対象外: `src/lib/openbd.ts` / `src/lib/bookinfo.ts` / `scripts/check-isbn.mjs`（T21と競合するため触らない）、
  既存記事 `rmatsuba-statistic-recommendation.md`（5冊のままでよい）
- depends: T2
- skills: なし

---

## 実装順序の推奨

**T1 → T2 → T3 → T4 → T5 → T6** が本筋。**T8（OGP）は T3 完了後にいつでも着手できる**ため、T4〜T6 と並行可能。

**T4・T6 は `design/` にエクスポート済みHTMLがあることが前提。** Claude Design での作業が終わるまでは、T1・T2・T3・T5・T8 を先に進められる。

## 未確定事項（実装開始前に解決が望ましい）

- **サービス名**（Skrinia / Matenaria / Panchaka が候補）— T1のプロジェクト名・T3のヘッダー表示に影響するが、**コード内にハードコードせず設定値として1箇所に置く**ことで後から変更可能にする
- **メール配信サービスの選定**（Buttondown / Substack 等）— T10で確定
- **フォームサービスの選定**（Tally / Google Forms 等）— T15で確定。**Tally を推奨**（無料枠で項目数の制限が緩く、埋め込みの見た目を調整でき、Google Forms より本文のトーンに馴染ませやすい）
- **書影APIのカバレッジ実測結果** — T5 の「APIをどこまで当てにするか」の判断材料。実測が低ければ `public/covers/` への手動登録が主経路になる
- **訴求コピー** — marketing-plan.md 未作成。T7 のトップページはコピーなしで実装し、確定後に追加する
