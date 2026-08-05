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
- goal: 記事のfrontmatterをZodで型検証し、「必ず5冊」をビルド時に強制する
- files: `src/content.config.ts` / `src/content/interviews/sample-yamada.md` / `src/content/interviews/sample-sato.md`
- acceptance:
  - スキーマに `books: z.array(bookSchema).length(5)` が定義されている
  - `isbn` が `z.string().regex(/^\d{13}$/)` で13桁数字のみに制約されている（ハイフンありはビルドエラー）
  - 選者情報に `name` / `affiliation` / `bio` / `links.x`（任意）が定義されている
  - **各書籍に `whyUnknown`（この本が知られていない理由）フィールドが必須項目として定義されている**（requirements R2c）。空文字ではビルドが通らない（`z.string().min(1)`）
  - 選者情報に **`credentials`（公開された実績・その領域に詳しい根拠）が必須項目**として定義されている（business-plan.md の選者資格基準）
  - サンプル記事2本が5冊ずつ持ち、`npm run build` が成功する
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

## T4: 5冊カードコンポーネント（書影あり／なしの両対応）
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
  - サンプル記事にアクセスすると、記事ヘッダー → 導入文 → 5冊のカード → まとめ → メール登録フォーム → フッターの順で表示される
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
  - 生成された画像に選者名・分野名・「5冊」であることが含まれ、**画像を50%（600×315px）に縮小しても選者名と分野名が判読できる**
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
  - 応募項目に「氏名 / 所属 / 専門分野 / Xアカウント（任意）/ 推薦する5冊（書名・著者・出版社）/ 各冊の選書理由」が明示されている（requirements R16a）
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
  - `npm run build` 後、`dist/search-index.json` が生成され、全記事の「タイトル・分野・選者名・5冊の書名」が含まれている
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
  - 5冊カードが折り返したときに、書影と書誌の位置関係が破綻していない
  - 記事本文の行長がモバイルで詰まりすぎていない（`px-5` の余白を含めて確認）
  - タップ領域が 44×44px 以上（リンク・ボタン）
  - **実機またはDevToolsのデバイスモードで全ページを目視確認した記録を残す**
- depends: T7, T12, T13, T14
- skills: dev-design, baseline-ui, fixing-accessibility

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
