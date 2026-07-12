# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 回答言語

ユーザーとの会話・説明・コミットメッセージ等は常に日本語で行うこと(コード自体・コード中の識別子・英語サイトからの引用・エラーメッセージの原文などはこの限りではない)。

## コマンド

```bash
docker compose -f docker-compose.dev.yml up --build   # 開発用: アプリ(localhost:3000, next dev+ホットリロード)+Postgres。db/init/*.sqlは新規ボリューム作成時のみ自動実行される
docker compose up --build                              # 本番用(NAS等): next buildの成果物で起動。SESSION_SECRET環境変数が必須
npm run dev                                             # Next.js開発サーバー(ローカルPostgresを直接使う場合のみ)
npm run build                                            # 本番ビルド
npm run lint                                              # next lint
```

`docker-compose.yml`(本番用)と`docker-compose.dev.yml`(開発用)はプロジェクト名を分けてある(`travel-log-prod`/`travel-log-dev`)ため、同一ホスト上で両方動かしてもコンテナ・イメージ・ボリュームは衝突しない。

このプロジェクトにテストスイート/テストコマンドは存在しない。

`db/init/*.sql`は既存のPostgresボリュームに対しては自動実行されない。`db`コンテナ/ボリュームが既に存在する場合、新規または変更したinitファイルは手動で適用する。

```bash
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d travel_log < db/init/<file>.sql
```

`db/init/02_tourist_spots.sql`(大量のスポットデータをINSERTするファイル)を編集する際は、本番の`spots`/`spot_types`テーブルではなく使い捨てのスキーマで検証すること(このリポジトリの過去のやり方: `create schema lint_check`→`create table lint_check.spots (like public.spots including all)`→`search_path`をそこに向けてファイルを流し込む→`drop schema lint_check cascade`)。シードファイルの検証のために本物の`public.spots`を`truncate`・再投入しないこと。

## アーキテクチャ

**バックエンドはNext.jsのRoute Handlersのみで、別立てのAPIサーバーは存在しない。** `app/api/**/route.ts`が`lib/db.ts`の単一の`pg.Pool`経由で直接Postgresと通信する。`lib/api-client.ts`はフロントエンド側から各Route Handlerを呼ぶための共通ラッパーで、レスポンスを`{ data, error }`に正規化する。

**認証はNextAuthではなく自前実装。** `lib/auth/session.ts`がHMAC-SHA256で署名したCookie(Web Crypto APIのみ使用、外部依存なし)を発行し、Edge実行の`middleware.ts`とNode実行のRoute Handlersの両方で同じロジックにより検証できるようにしている。Cookieには`{ sub: userId, exp }`のみを持たせ、roleは意図的にCookieに含めていない — `lib/auth/current-user.ts`経由で毎リクエストDBから引き直すことで、管理者によるロール変更やDB作り直しが古いCookieのまま反映されない事態を防いでいる。`middleware.ts`は`/login`と`/api/**`以外の全ルートをガードする。

**単一の`spots`テーブルを`spot_types`により複数の「種類」で使い回す設計。** `app_settings`は`active_spot_type_id`を保持するsingleton行で、ほとんどのspotsクエリは`where spot_type_id = (select active_spot_type_id from app_settings)`で絞り込む。現状データがあるのは`tourist`種類のみ(`post_office`/`goshuin`は今後用の空の種類)。`spots.rank`/`category`は自由入力で、`spot_type = 'tourist'`のときのみ意味を持つ(値の一覧は`lib/types.ts`の`RANKS`/`CATEGORIES`とそのコメントを参照)。

**スポットの新規登録は経路を問わず必ず承認待ちを通る。** 地図上での右クリック追加、`/admin`の追加フォーム、CSVインポート(`lib/csv.ts`+`/admin`)はすべて`app/api/spots/route.ts`の同じ挿入ロジックを通り、投稿者が管理者であっても常に`status = 'pending'`になる。承認・却下は`/admin`側の別ステップ。

**`reviews`と`visits`は意図的に非対称な設計。** `reviews`=公開・本文のみ・`(user_id, spot_id)`ごとに1件(再投稿はupsert)、必訪ランクの算出には一切使わない。`visits`=非公開・同一ユーザー×同一スポットで複数件可、`photos`はブラウザ側で縮小・圧縮したBase64文字列を`text[]`カラムに直接保存(外部ストレージ連携なし、枚数が多いとDBが肥大化する点はREADME参照)。

**tourist spotsの`rank`はこのリポジトリの外で一度だけ計算されたパイプラインの成果物であり、アプリ側が動的に計算するものではない。** Wikipedia(ja)月次ページビュー数に基づく相対順位(パーセンタイル)の機械分類(README「ランクの決め方」および`db/init/02_tourist_spots.sql`冒頭のコメント参照)。手動でスポットを追加する場合も、この基準に沿ったランクを付けること。

## 外部データソース(Wikipedia、OSM Overpass/Nominatim、政府オープンデータ等)を扱う際の注意

このリポジトリのスポットデータは、OSM Overpass・Wikipedia API・Nominatimからの取得によって構築・拡張されてきた。この種のデータ収集作業を行う際は、

- 自分でレート制限をかけ、リクエストには識別可能な`User-Agent`(名前+連絡先)を設定すること — Overpass API・NominatimはこのプロジェクトAlone専有のインフラではなく、無料でコミュニティ運営されているフェアユース前提のサービス
- レンダリング済みHTMLのスクレイピングより、公式API(MediaWiki REST/Action API、Overpass QL)を優先すること
- 政府や第三者のオープンデータには、このアプリのライセンスと整合しない利用制限(非商用限定など)が付いていることが多い。そうしたデータセットの中身(名称・座標・説明文)をそのまま`db/init/`に転記しないこと。せいぜい「抜けているスポットに気づくためのヒント」として使い、実際のデータ(座標・説明文)はライセンス面で問題のない別ソースから取り直すこと
- 一括でスポットを追加した後は、コミット前に既存行との重複(名前一致・近接座標)がないか確認すること — 既存の2,700件超のシードデータにも、過去のインポートで名前だけの突き合わせをすり抜けた重複に近いものが存在する

## コミット前に

このアプリは実際のユーザーデータ(`users.email`、`visits.memo`、Base64の`visits.photos`、`reviews.body`)を保持する。コミット前には、差分にプレースホルダーではない実際の個人情報(実メールアドレス・実名・写真・DBダンプ/エクスポート等)が紛れ込んでいないか確認すること — ローカルのDocker DBに実際のテストアカウントを入れたまま作業していると、気づかず混入しやすい。
