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

**単一の`spots`テーブルを`spot_types`により複数の「種別」で使い回す設計。** `tourist`(観光地。都道府県別に`db/init/tourist_by_prefecture/`配下へ分割)がアプリ初期化時(`db/init/01_schema.sql`)に必ず作成される唯一の既定種別で、それ以外の種別は管理者が`/[type]/admin`から追加する(空の種別ではデータが入らないだけで、削除しない限り存在し続ける)。データ量の大きい種別を追加する場合は、シードデータを`db/init/`に直接コミットせず外部リポジトリ[travel-log-data](../travel-log-data)にCSVとして置き、`/[type]/admin`のCSVインポートから取り込む運用にできる(下記「外部データソース」の段落参照)。画面は`/[type]/map`のように`spot_types.key`をURLの動的セグメントとして持ち、種別ごとに独立してアクセスする(`app_settings.active_spot_type_id`はログイン後・ルート`/`アクセス時の既定リダイレクト先を1つだけ保持するのみで、他の種別を隠すものではない)。種別ごとの公開範囲は`spot_type_settings`の`public_visible`設定(既定false=admin/spot_admin限定)で制御し、`lib/spot-type-access.ts`の`canViewSpotType`で判定する(`/[type]/admin`だけは`public_visible`に関わらず常にアクセス可)。かつてあった`spot_types.visibility`列(`public`/`admin_only`/`disabled`の3値)は廃止し、`disabled`(誰にも見せない)相当は種別自体の削除で代替するようにした。新しい種別は`/[type]/admin`のキー+表示名の手入力フォームのほか、`{ key, label, settings?, ranks? }`形式のJSONファイルアップロードでも作成できる(`lib/types.ts`の`parseSpotTypeDefinition`でバリデーション、`AdminView`側で`spotTypes.create`→(settings/ranksがあれば)`spotTypes.applySettings`の2段APIコールに分解する。バックエンドに専用エンドポイントは増やしていない)。travel-log-dataリポジトリの`<スポットキー>/settings.json`がこの形式の実例。`spots.rank`/`category`は自由入力で、`spot_type = 'tourist'`のときのみ「ランクの決め方」の基準が意味を持つ(値の一覧は`lib/types.ts`の`RANKS`/`CATEGORIES`とそのコメントを参照)。

**スポット種別ごとのON/OFF設定(公開範囲・口コミ・Wikipediaリンク)はEAV形式で持つ。** `reviews_enabled`/`wikipedia_enabled`/`public_visible`は`spot_types`に列を持たず、EAV形式の`spot_type_settings`テーブル(`spot_type_id, key, value` — 値は`'true'`/`'false'`の文字列)に保存する。新しい設定を増やす際にDBマイグレーションが要らないようにするための設計で、キー・既定値・表示名は`lib/types.ts`の`SPOT_TYPE_SETTING_DEFAULTS`/`SPOT_TYPE_SETTING_LABELS`に登録するだけでよい(行が存在しないキーは設定ごとの既定値扱い、`getSpotTypeSetting`参照)。`public_visible`は既定`false`(=種別追加当初は非公開・admin/spot_admin限定)で、他2つは既定`true`。`app/api/spot-types/[id]/route.ts`のPATCHは`{ settings: { key: boolean, ... } }`を受け取り`spot_type_settings`へupsertする汎用エンドポイントで、設定を増やしてもAPI自体の変更は不要。`SpotType`型の`settings`フィールド(`key→value`の文字列マップ)は`lib/spot-types-query.ts`の`SPOT_TYPE_SELECT`(`spot_type_settings`をjsonbに集約するSELECT共通部品)を使うクエリでのみ埋まる点に注意(`select * from spot_types`だけでは`settings`は付与されない)。

**ランクの一覧・見た目(色・縁取り線の色・地図ピンの大きさ・ラベル)もスポット種別ごとにJSONで持つ(`lib/rankStyle.ts`)。** 値がbooleanではないため`SpotTypeSettingKey`の仕組みとは別扱いで、`spot_type_settings`の`rank_styles`キー(`RANK_STYLES_SETTING_KEY`)にJSON文字列(`RankStyleDefinition[]`)を保存する。行が無い・parse失敗時は`DEFAULT_RANK_STYLES`(観光地の現行A〜E配色)にフォールバックする(`resolveRankStyles`)。配列の並び順がそのままランクの並び順(`getRankOrder`、旧`lib/rankStyle.ts`の`KNOWN_ORDER`ハードコードの後継)になり、`app/api/spots/route.ts`のページング一覧もSQLの`array_position`でこの並びをそのまま使う(旧CASE文のハードコードは廃止)。ラベルは文字列または`{ image: base64 dataURL }`のどちらか(`isImageLabel`で判定)。`textColor`は省略可で、省略時は`autoTextColor`が背景色の明度から白/濃色を自動選択する。地図ピン(`lib/pinIcon.ts`の`ensurePinImage`、画像ラベル読み込みのため非同期)・バッジ(`components/RankBadge.tsx`、Tailwindの動的クラスはJITに拾われないため常にinline styleで色を当てる)・ミニマップ(`components/MiniMap.tsx`)・絞り込みチップ(`components/FilterBar.tsx`)はいずれも`useRankStyles(typeKey)`フック(`/api/spot-types`の結果から解決、GETキャッシュにより同一ページでの重複リクエストなし)経由でこの配列を受け取って描画する。非公開スポット(`status='private'`)は縁取り線の色はそのまま破線にするだけで、色・大きさ・ラベルはランクと同じにする(公開スポットの縁取りも常に実線で描く。旧実装は非公開のときしか縁取り自体を描いていなかった点の修正でもある)。`app/api/spot-types/[id]/route.ts`のPATCHの`settings`は文字列値(`rank_styles`)も受け付けるよう`boolean | string`に拡張し、保存前に`parseRankStyles`で妥当性を検証する。管理画面からのスポット種別JSON作成(`SpotTypeDefinitionFile`)の`ranks`フィールドもこの形式で、省略時・手入力フォームでの追加時はDEFAULT_RANK_STYLESのままになる。

**管理画面の`/[type]/admin`にはadmin専用の「スポット全削除」(`app/api/spots/purge/route.ts`)と「スポット種別の削除」(`DELETE /api/spot-types/[id]`、同ファイルのPATCHと同居)がある。** 前者は`spot_types`の行自体は消さずstatus問わず対象種別の全スポットと紐づく`visits`/`visit_plans`/`reviews`(FKの`on delete cascade`)・写真ファイルを一括で消す。後者は同じ削除ロジック(スポットが残っていれば先に全件削除)を実行した上で`spot_types`の行自体も削除する(現在表示中の種別を一覧に出さないのはUI側の制約のみで、APIとしては現在の種別かどうかを見ない)。後者は`public_visible`がtrue(一般公開中)の種別、または対象種別が`app_settings.active_spot_type_id`(ログイン後既定)の場合はAPIレベルで拒否する(既定の種別は常にpublic_visible=trueであるため後者は実質前者に含まれるが、防御的に両方チェックしている)。どちらもCSVでデータを作り直す前提の機能で、spot_adminには許可していない(ユーザー管理と同様、他ユーザーのデータを巻き込むため)。ログイン後に自動で開く既定の種別の変更は、この一括削除等の管理系操作とは別の独立したセレクトボックス(`app_settings.active_spot_type_id`を更新)として`/[type]/admin`に置いている。

**スポットの新規登録は地図上での右クリック追加、`/[type]/admin`の追加フォーム、CSVインポート(`lib/csv.ts`+`/[type]/admin`)いずれも`app/api/spots/route.ts`の同じ挿入ロジックを通る。** status未指定時の既定はroleにより`user`は`private`、それ以外(moderator/spot_admin/admin)は`pending`(`ALLOWED_STATUS_BY_ROLE`が許す範囲でstatusを明示すれば`published`等も選べる)。CSVインポートは`/[type]/admin`(spot_admin/admin専用)からのみ行える経路のため、`AdminView`側で常に`status: 'published'`を明示し、承認待ちを経由せず即座に公開する。それ以外の経路(右クリック追加・追加フォームでの既定)は引き続き承認待ちを通り、承認・却下は`/[type]/admin`側の別ステップで行う。CSVインポートは差分更新で、`AdminView`側が事前読み込み済みの全件(status問わず)と`name`+`prefecture`+`lat`+`lng`の完全一致で突き合わせ、既存分をスキップしてから`app/api/spots/route.ts`に送る。かつてあった「SQLシードとの同期」「重複スポットの削除」機能はこの差分インポートに一本化して廃止した。新規分は`AdminView`側で1,000件ずつのチャンクに分けて順番に送信し、進捗(◯件/◯件)を画面に表示する(1リクエストにまとめると大量データでタイムアウトする恐れがあるため)。ロールは`admin`/`spot_admin`/`moderator`/`user`の4種類(`lib/types.ts`の`Role`参照)。ユーザー管理(`app/api/admin/users/**`)はadmin専用でspot_adminには許可されない。

**`reviews`と`visits`は意図的に非対称な設計。** `reviews`=公開・本文のみ・`(user_id, spot_id)`ごとに1件(再投稿はupsert)、必訪ランクの算出には一切使わない。`visits`=非公開・同一ユーザー×同一スポットで複数件可。`visit_plans`(訪問予定・行きたい場所のブックマーク)も非公開で、該当スポットの`visits`が作成されると自動的に削除される。`photos`(text[])にはBase64ではなく、`photos/`フォルダ(docker-composeでbindマウント、`lib/photos.ts`)へ保存したファイルの相対パス`<ユーザーID>/<年>/<月>/<uuid>.<ext>`を保存する。配信は認証付き`/api/photos/[...path]`のみ(先頭セグメント=本人チェック)。旧方式のBase64 data URLがDBに残っていても表示は動く(`visitPhotoSrc`参照)が、`scripts/migrate-photos-to-files.mjs`で移行できる。

**tourist spotsの`rank`はこのリポジトリの外で一度だけ計算されたパイプラインの成果物であり、アプリ側が動的に計算するものではない。** Wikipedia(ja)月次ページビュー数に基づく相対順位(パーセンタイル)の機械分類(README「ランクの決め方」および`db/init/tourist_by_prefecture/`配下の各ファイル冒頭のコメント参照)。手動でスポットを追加する場合も、この基準に沿ったランクを付けること。

## 外部データソース(Wikipedia、OSM Overpass/Nominatim、政府オープンデータ等)を扱う際の注意

このリポジトリのスポットデータは、OSM Overpass・Wikipedia API・Nominatimからの取得によって構築・拡張されてきた。この種のデータ収集作業を行う際は、

- 自分でレート制限をかけ、リクエストには識別可能な`User-Agent`(名前+連絡先)を設定すること — Overpass API・NominatimはこのプロジェクトAlone専有のインフラではなく、無料でコミュニティ運営されているフェアユース前提のサービス
- レンダリング済みHTMLのスクレイピングより、公式API(MediaWiki REST/Action API、Overpass QL)を優先すること
- 政府や第三者のオープンデータには、このアプリのライセンスと整合しない利用制限(非商用限定など)が付いていることが多い。そうしたデータセットの中身(名称・座標・説明文)をそのまま`db/init/`に転記しないこと。せいぜい「抜けているスポットに気づくためのヒント」として使い、実際のデータ(座標・説明文)はライセンス面で問題のない別ソースから取り直すこと
- 一括でスポットを追加した後は、コミット前に既存行との重複(名前一致・近接座標)がないか確認すること — 既存の`tourist`のシードデータ(7,050件)にも、過去のインポートで名前だけの突き合わせをすり抜けた重複に近いものが存在する
- 容量の大きいシードデータ(数千〜数万件規模)は、travel-logリポジトリ本体の`db/init/`に直接コミットせず、外部リポジトリ[travel-log-data](../travel-log-data)側に`<スポットキー>/`フォルダ単位のCSVとして置き、`/[type]/admin`の既存CSVインポート機能で取り込む(詳細はtravel-log-data/README.md参照)。`tourist`は現状`db/init/`に同梱したままだが、新規追加する種別は基本的にこちらの形に揃えること

## コミット前に

このアプリは実際のユーザーデータ(`users.email`、`visits.memo`、Base64の`visits.photos`、`reviews.body`)を保持する。コミット前には、差分にプレースホルダーではない実際の個人情報(実メールアドレス・実名・写真・DBダンプ/エクスポート等)が紛れ込んでいないか確認すること — ローカルのDocker DBに実際のテストアカウントを入れたまま作業していると、気づかず混入しやすい。

コードに変更を加えたら、その変更でREADME.md・CLAUDE.mdの記述(画面のパス、ロール、データ件数、機能の説明など)が古くならないか確認し、必要なら同じコミットで更新すること。特にルーティング構造・ロールの種別と権限・スポット種別ごとのデータ件数・`db/init/`のファイル構成は変更が入りやすく、記述が古いまま放置されがち。
