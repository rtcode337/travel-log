# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 回答言語

ユーザーとの会話・説明・コミットメッセージ等は常に日本語で行うこと(コード自体・コード中の識別子・英語サイトからの引用・エラーメッセージの原文などはこの限りではない)。

## コマンド

```bash
docker compose -f docker-compose.dev.yml up --build   # 開発用: アプリ(localhost:3000, next dev+ホットリロード)+Postgres。db/init/*.sqlは db/data/ が空の場合のみ自動実行される
docker compose up --build                              # 本番用(NAS等): next buildの成果物で起動。SESSION_SECRET環境変数が必須
npm run dev                                             # Next.js開発サーバー(ローカルPostgresを直接使う場合のみ)
npm run build                                            # 本番ビルド
npm run lint                                              # next lint
```

`docker-compose.yml`(本番用)と`docker-compose.dev.yml`(開発用)はプロジェクト名を分けてある(`travel-log-prod`/`travel-log-dev`)ため、同一ホスト上で両方動かしてもコンテナ・イメージ・ボリュームは衝突しない。

このプロジェクトにテストスイート/テストコマンドは存在しない。

`db/init/*.sql`は既存の`db/data/`(Postgresの実データ。リポジトリ直下にbindマウントされるが`.gitignore`対象)に対しては自動実行されない。`db/data/`が既に存在する場合、新規または変更したinitファイルは手動で適用する。

```bash
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d travel_log < db/init/<file>.sql
```

`db/init/tourist_by_prefecture/*.sql`(都道府県ごとの観光地データをINSERTするファイル。`02_tourist_spots_by_prefecture.sh`が全件読み込む)を編集する際は、本番の`spots`/`spot_types`テーブルではなく使い捨てのスキーマで検証すること(このリポジトリの過去のやり方: `create schema lint_check`→`create table lint_check.spots (like public.spots including all)`→`search_path`をそこに向けてファイルを流し込む→`drop schema lint_check cascade`)。シードファイルの検証のために本物の`public.spots`を`truncate`・再投入しないこと。

`docker-entrypoint-initdb.d`(=`db/init/`)はサブディレクトリを走査しない(postgres公式イメージの`docker-entrypoint.sh`は`/docker-entrypoint-initdb.d/*`を1階層のみglobし、ディレクトリは`ignoring`されて無視される)。そのため`tourist_by_prefecture/`配下は`db/init/02_tourist_spots_by_prefecture.sh`という実行可能なラッパースクリプトを通じて読み込ませている。新しく都道府県別以外のサブフォルダ構成を追加する場合も、同様のラッパー(または`docker-entrypoint-initdb.d`直下への配置)が必要になる点に注意。

## アーキテクチャ

**バックエンドはNext.jsのRoute Handlersのみで、別立てのAPIサーバーは存在しない。** `app/api/**/route.ts`が`lib/db.ts`の単一の`pg.Pool`経由で直接Postgresと通信する。`lib/api-client.ts`はフロントエンド側から各Route Handlerを呼ぶための共通ラッパーで、レスポンスを`{ data, error }`に正規化する。

**認証はNextAuthではなく自前実装。** `lib/auth/session.ts`がHMAC-SHA256で署名したCookie(Web Crypto APIのみ使用、外部依存なし)を発行し、Edge実行の`middleware.ts`とNode実行のRoute Handlersの両方で同じロジックにより検証できるようにしている。Cookieには`{ sub: userId, exp }`のみを持たせ、roleは意図的にCookieに含めていない — `lib/auth/current-user.ts`経由で毎リクエストDBから引き直すことで、管理者によるロール変更やDB作り直しが古いCookieのまま反映されない事態を防いでいる。`middleware.ts`は`/login`と`/api/**`以外の全ルートをガードする。

**単一の`spots`テーブルを`spot_types`により複数の「種類」で使い回す設計。** `tourist`(観光地。都道府県別に`db/init/tourist_by_prefecture/`配下へ分割)/`post_office`(郵便局24,526件)/`goshuin`(御朱印46,574件)の3種類ともデータ投入済み(空の種類ではない)。画面は`/[type]/map`のように`spot_types.key`をURLの動的セグメントとして持ち、種類ごとに独立してアクセスする(`app_settings.active_spot_type_id`はログイン後・ルート`/`アクセス時の既定リダイレクト先を1つだけ保持するのみで、他の種類を隠すものではない)。`spot_types.visibility`(`public`/`admin_only`/`disabled`)で種類ごとの公開範囲を制御し、`lib/spot-type-access.ts`の`canViewSpotType`で判定する(`/[type]/admin`だけは無効化した種類を再有効化できるよう常にアクセス可)。`spots.rank`/`category`は自由入力で、`spot_type = 'tourist'`のときのみ「ランクの決め方」の基準が意味を持つ(値の一覧は`lib/types.ts`の`RANKS`/`CATEGORIES`とそのコメントを参照)。`goshuin`はWikipedia記事の有無で`A〜E`(6,584件)と機械採録の`Z`=未整理(39,990件)に分かれ、`post_office`は知名度順位ではなく地図表示用の固定値`郵便局`を使う。

**スポットの新規登録は地図上での右クリック追加、`/[type]/admin`の追加フォーム、CSVインポート(`lib/csv.ts`+`/[type]/admin`)いずれも`app/api/spots/route.ts`の同じ挿入ロジックを通る。** status未指定時の既定はroleにより`user`は`private`、それ以外(moderator/spot_admin/admin)は`pending`(`ALLOWED_STATUS_BY_ROLE`が許す範囲でstatusを明示すれば`published`等も選べる)。CSVインポートは`/[type]/admin`(spot_admin/admin専用)からのみ行える経路のため、`AdminView`側で常に`status: 'published'`を明示し、承認待ちを経由せず即座に公開する。それ以外の経路(右クリック追加・追加フォームでの既定)は引き続き承認待ちを通り、承認・却下は`/[type]/admin`側の別ステップで行う。ロールは`admin`/`spot_admin`/`moderator`/`user`の4種類(`lib/types.ts`の`Role`参照)。ユーザー管理(`app/api/admin/users/**`)はadmin専用でspot_adminには許可されない。

**`reviews`と`visits`は意図的に非対称な設計。** `reviews`=公開・本文のみ・`(user_id, spot_id)`ごとに1件(再投稿はupsert)、必訪ランクの算出には一切使わない。`visits`=非公開・同一ユーザー×同一スポットで複数件可。`visit_plans`(訪問予定・行きたい場所のブックマーク)も非公開で、該当スポットの`visits`が作成されると自動的に削除される。`photos`(text[])にはBase64ではなく、`photos/`フォルダ(docker-composeでbindマウント、`lib/photos.ts`)へ保存したファイルの相対パス`<ユーザーID>/<年>/<月>/<uuid>.<ext>`を保存する。配信は認証付き`/api/photos/[...path]`のみ(先頭セグメント=本人チェック)。旧方式のBase64 data URLがDBに残っていても表示は動く(`visitPhotoSrc`参照)が、`scripts/migrate-photos-to-files.mjs`で移行できる。

**tourist spotsの`rank`はこのリポジトリの外で一度だけ計算されたパイプラインの成果物であり、アプリ側が動的に計算するものではない。** Wikipedia(ja)月次ページビュー数に基づく相対順位(パーセンタイル)の機械分類(README「ランクの決め方」および`db/init/tourist_by_prefecture/`配下の各ファイル冒頭のコメント参照)。手動でスポットを追加する場合も、この基準に沿ったランクを付けること。

## 外部データソース(Wikipedia、OSM Overpass/Nominatim、政府オープンデータ等)を扱う際の注意

このリポジトリのスポットデータは、OSM Overpass・Wikipedia API・Nominatimからの取得によって構築・拡張されてきた。この種のデータ収集作業を行う際は、

- 自分でレート制限をかけ、リクエストには識別可能な`User-Agent`(名前+連絡先)を設定すること — Overpass API・NominatimはこのプロジェクトAlone専有のインフラではなく、無料でコミュニティ運営されているフェアユース前提のサービス
- レンダリング済みHTMLのスクレイピングより、公式API(MediaWiki REST/Action API、Overpass QL)を優先すること
- 政府や第三者のオープンデータには、このアプリのライセンスと整合しない利用制限(非商用限定など)が付いていることが多い。そうしたデータセットの中身(名称・座標・説明文)をそのまま`db/init/`に転記しないこと。せいぜい「抜けているスポットに気づくためのヒント」として使い、実際のデータ(座標・説明文)はライセンス面で問題のない別ソースから取り直すこと
- 一括でスポットを追加した後は、コミット前に既存行との重複(名前一致・近接座標)がないか確認すること — 既存の74,000件超のシードデータ(tourist/post_office/goshuin合算)にも、過去のインポートで名前だけの突き合わせをすり抜けた重複に近いものが存在する

## コミット前に

このアプリは実際のユーザーデータ(`users.email`、`visits.memo`、Base64の`visits.photos`、`reviews.body`)を保持する。コミット前には、差分にプレースホルダーではない実際の個人情報(実メールアドレス・実名・写真・DBダンプ/エクスポート等)が紛れ込んでいないか確認すること — ローカルのDocker DBに実際のテストアカウントを入れたまま作業していると、気づかず混入しやすい。

コードに変更を加えたら、その変更でREADME.md・CLAUDE.mdの記述(画面のパス、ロール、データ件数、機能の説明など)が古くならないか確認し、必要なら同じコミットで更新すること。特にルーティング構造・ロールの種類と権限・スポットの種類ごとのデータ件数・`db/init/`のファイル構成は変更が入りやすく、記述が古いまま放置されがち。
