# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 回答言語

ユーザーとの会話・説明・コミットメッセージ等は常に日本語で行うこと(コード自体・コード中の識別子・英語サイトからの引用・エラーメッセージの原文などはこの限りではない)。

## コマンド

```bash
docker compose -f docker-compose.dev.yml up --build   # 開発用: アプリ(localhost:3000, next dev+ホットリロード)+Postgres。スキーマ作成・未適用マイグレーションはdb-migrateサービスが自動で行う
docker compose pull && docker compose up -d            # 本番用: GHCRのビルド済みイメージ(mainへのpushでGitHub Actionsが自動ビルド)で起動。未適用のマイグレーションはdb-migrateサービスが自動で当てる。SESSION_SECRET環境変数が必須(.env可)
npm run dev                                             # Next.js開発サーバー(ローカルPostgresを直接使う場合のみ)
npm run build                                            # 本番ビルド
npm run lint                                              # next lint
```

`docker-compose.yml`(本番用)と`docker-compose.dev.yml`(開発用)はプロジェクト名を分けてある(`travel-log-prod`/`travel-log-dev`)ため、同一ホスト上で両方動かしてもコンテナ・イメージ・ボリュームは衝突しない。

このプロジェクトにテストスイート/テストコマンドは存在しない。

### スキーマ変更のルール

DB定義は`db/init/01_schema.sql`の1ファイルにすべてまとまっている(テーブル・索引・トリガー・既定のスポット種別の投入まで)。**このファイルが「現在あるべきスキーマの唯一の定義」**で、追加分を`02_...`のような別の初期化ファイルに切り出す方式は取らない。スキーマを変えるときは常にこのファイルだけを編集すること。

あわせて、**テーブルに変更を加えた場合は同じコミットで`db/migrations/`に移行スクリプトを追加し、本番DBを既存データを保持したまま移行可能にすること**(本番には利用者の訪問記録・写真が入るため、`db/data/`を捨てる運用はできない)。ファイル名は`<連番>_<内容>.sql`で、ファイル名がそのまま`schema_migrations.version`になる。**`begin`/`commit`と`schema_migrations`へのinsertはスクリプトに書かない**(どちらも`db/entrypoint.sh`が受け持つ)。全文idempotentにすること — 新規DBに対しても一度は実行される。詳細は`db/migrations/README.md`。

適用は`docker compose up`で自動的に行われる(手で流す必要はない。下記「DBの初期化・マイグレーションの流れ」参照)。

移行スクリプトを書いたら、**旧スキーマのダンプに当てた結果が新規作成したDBと一致することを確認する**(`information_schema.columns`・`pg_trigger`・`pg_indexes`を新旧で突き合わせる。手順は`db/migrations/README.md`)。列の並び順だけはPostgresでは既存テーブルに対して変更できないため一致しないが、アプリは常に列名で読み書きしているため影響しない。

### DBの初期化・マイグレーションの流れ

composeは`db-init` → `db` → `db-migrate` → `app`の順に起動する。`db-init`と`db-migrate`は同じイメージ(`db/Dockerfile`、`db/entrypoint.sh`のサブコマンド違い)で、どちらも1回走って終了するワンショット。

| サービス | 役割 | タイミング |
|---|---|---|
| `db-init` (`prepare`) | `db/data`の作成と所有者/パーミッション調整 | dbの起動**前** |
| `db` | Postgres本体(空のDBができるだけ。スキーマは作らない) | — |
| `db-migrate` (`migrate`) | スキーマ本体(`/init/01_schema.sql`)と`/migrations`の未適用SQLを適用し`schema_migrations`に記録 | dbのhealthcheck通過**後** |
| `app` | Next.js。`db-migrate`が正常終了するまで起動しない | 最後 |

スキーマ本体もマイグレーションSQLも`db-init`イメージに焼き込まれるため、本番ホストのリポジトリの新旧に関わらず、pullしたイメージの中身がそのまま適用される。マイグレーションが失敗すると`db-migrate`が非ゼロ終了し、`app`も起動しないため、古いスキーマのままアプリが動くことはない。

`01_schema.sql`は`schema_migrations`上では`000_init_schema`という名前の「一番先頭のマイグレーション」として扱う。空のDBには実行し、既にテーブルがあるDB(旧方式でinitdbが作ったもの)には実行せず適用済みとして記録するだけにするので、既存の本番DBをそのまま引き継げる。

**`db/init`をdbコンテナにマウントしないのは意図的**。かつては`docker-entrypoint-initdb.d`に`:ro`マウントし、`db-init`が`chmod -R a+rX`をかけていたが、git管理下のファイルのパーミッションをrootで書き換えるため、`01_schema.sql`を更新するとホスト側の`git pull`が失敗するようになっていた。スキーマ本体もイメージ側から流す方式にして解消した(`prepare`が触るのはgit管理外の`db/data`だけ)。

開発環境では、スキーマを変えたら`db/data/`を捨てて作り直すのが手軽(移行スクリプトの検証は下記の使い捨てDBで行う)。

```bash
docker compose -f docker-compose.dev.yml down
rm -rf db/data/pgdata   # 既存データを捨てる(訪問記録・アカウントも消える)
docker compose -f docker-compose.dev.yml up --build
```

既存データ(`db/data/`。Postgresの実データで、リポジトリ直下にbindマウントされるが`.gitignore`対象)を消さずにスキーマ・移行スクリプトを試したい場合は、同じPostgresコンテナ内に使い捨てDBを作って流すとよい。

```bash
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d postgres -c "create database schema_check"
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d schema_check -v ON_ERROR_STOP=1 < db/init/01_schema.sql
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d postgres -c "drop database schema_check"
```

全テーブルが`created_at`/`updated_at`を持ち、`updated_at`は共通の`set_updated_at()`トリガーで自動更新される。テーブルを追加したら、対応する`create trigger <table>_set_updated_at`をファイル下部のトリガー定義の並びにも追加すること。



[travel-log-data](../travel-log-data)側の`tourist/spots.csv`(観光地データ全件。列は`name,name_kana,lat,lng,region,series,categories,description`)を編集する際は、本番の`spots`/`spot_types`テーブルではなく使い捨てのスキーマで検証すること(このリポジトリの過去のやり方: `create schema lint_check`→`create table lint_check.spots (like public.spots including all)`→`search_path`をそこに向けてCOPYする→`drop schema lint_check cascade`)。シードファイルの検証のために本物の`public.spots`を`truncate`・再投入しないこと。

スポットのシードデータは`db/init/`に置かず、`tourist`を含む全種別のスポットデータを`/[type]/admin`のCSVインポートから手動で取り込む(下記「外部データソース」の段落参照)。

## アーキテクチャ

### バックエンド構成

Next.jsのRoute Handlersのみで、別立てのAPIサーバーは存在しない。`app/api/**/route.ts`が`lib/db.ts`の単一の`pg.Pool`経由で直接Postgresと通信する。`lib/api-client.ts`はフロントエンド側から各Route Handlerを呼ぶための共通ラッパーで、レスポンスを`{ data, error }`に正規化する。

### 認証

NextAuthではなく自前実装。`lib/auth/session.ts`がHMAC-SHA256で署名したCookie(Web Crypto APIのみ使用、外部依存なし)を発行し、Edge実行の`middleware.ts`とNode実行のRoute Handlersの両方で同じロジックにより検証できるようにしている。Cookieには`{ sub: userId, exp }`のみを持たせ、roleは意図的にCookieに含めていない — `lib/auth/current-user.ts`経由で毎リクエストDBから引き直すことで、管理者によるロール変更やDB作り直しが古いCookieのまま反映されない事態を防いでいる。`middleware.ts`は`/login`と`/api/**`、および`/manifest.webmanifest`(ブラウザのmanifest取得は既定でCookieを送らないため、ガードするとPWAとしてインストールできなくなる)以外の全ルートをガードする。

### PWA(インストール可能化)

manifest(`app/manifest.ts`、Next.jsのMetadata Files規約で`/manifest.webmanifest`として配信)+アイコン(`public/icons/`のmanifest用3枚と、`app/icon.png`・`app/apple-icon.png`のファビコン/apple-touch-icon)による最小構成のPWA対応で、Service Worker・オフライン対応は意図的に持たない(「デプロイしたのに古い画面が出る」系の問題を避けるため、必要になるまで導入しない方針)。インストール後も中身は同じWebアプリで、認証Cookieもそのまま使われる。iOSはmanifestの`display`/`icons`を見ないため、`app/layout.tsx`の`metadata.appleWebApp`と`app/apple-icon.png`で別途同等の設定をしている。`/manifest.webmanifest`は`middleware.ts`のガード対象から除外が必要(上記「認証」参照)。アイコンPNGは`scripts/generate-icons.mjs`(sharp使用、依存には含めない)で生成したものをコミットしてあり、デザイン変更時のみ再生成する。

### ビルド番号

GitHub Actions(`.github/workflows/docker-publish.yml`)がビルド時に`<JST日時>-<短縮コミットハッシュ>`形式のビルド番号を生成し、`--build-arg BUILD_NUMBER`でDockerfileのprodステージに渡して`ENV BUILD_NUMBER`として焼き込む。`app/[type]/admin/page.tsx`(サーバーコンポーネント)が`process.env.BUILD_NUMBER`を読んで`AdminView`の`buildNumber` propに渡し、管理画面の見出し横に表示する(未設定時は「開発ビルド」)。`NEXT_PUBLIC_`で`next build`時に埋め込むのではなくリクエスト時に環境変数を読む方式にしてあるため、ビルド番号が毎回変わってもNext.jsのビルドキャッシュには影響しない(prodステージは`next build`の後段のため、Dockerレイヤキャッシュも実質壊さない)。

### スポット種別(`spot_types`)の設計

単一の`spots`テーブルを`spot_types`により複数の「種別」で使い回す設計。`tourist`(観光地)がアプリ初期化時(`db/init/01_schema.sql`)に必ず作成される唯一の既定種別で、それ以外の種別は管理者が`/[type]/admin`から追加する(空の種別ではデータが入らないだけで、削除しない限り存在し続ける)。既定種別といっても自動で作られるのは`spot_types`の行だけで、スポットデータ自体は他の種別と同様シードデータを`db/init/`に直接コミットせず外部リポジトリ[travel-log-data](../travel-log-data)にCSVとして置き、`/[type]/admin`のCSVインポートから取り込む(下記「外部データソース」の段落参照)。観光地データの`description`はWikipedia記事冒頭文の引用でCC BY-SA 4.0、`name`/`lat`/`lng`の一部はOpenStreetMap(ODbL)由来のため、travel-logリポジトリ本体には同梱せずtravel-log-data側でのみ管理・出典表示する。

画面は`/[type]/map`のように`spot_types.key`をURLの動的セグメントとして持ち、種別ごとに独立してアクセスする(ルート`/`アクセス時のリダイレクト先は、最後に開いていた種別のCookie `last_spot_type` — `lib/last-spot-type.ts`。`middleware.ts`が`/[type]/(map|spots|account|admin)`アクセス時に書き込み、`app/page.tsx`が読み取り時に`canViewSpotType`で検証する — を最優先し、無い・開けない場合に`app_settings.active_spot_type_id`の既定へフォールバックする。どちらも他の種別を隠すものではない)。種別ごとの公開範囲は`spot_type_settings`の`public_visible`設定(既定false=admin/spot_admin限定)で制御し、`lib/spot-type-access.ts`の`canViewSpotType`で判定する(`/[type]/admin`だけは`public_visible`に関わらず常にアクセス可)。かつてあった`spot_types.visibility`列(`public`/`admin_only`/`disabled`の3値)は廃止し、`disabled`(誰にも見せない)相当は種別自体の削除で代替するようにした。

新しい種別は`/[type]/admin`のキー+表示名の手入力フォームのほか、`{ key, label, settings?, series?, categories? }`形式のJSONファイルアップロードでも作成できる(`lib/types.ts`の`parseSpotTypeDefinition`でバリデーション、`AdminView`側で`spotTypes.create`→(settings/series/categoriesがあれば)`spotTypes.applySettings`の2段APIコールに分解する。バックエンドに専用エンドポイントは増やしていない)。travel-log-dataリポジトリの`<スポットキー>/settings.json`がこの形式の実例。同じ形式のJSONは、既存の種別に対して「スポット種別の設定」セクション(admin専用)の「JSONファイルから設定を反映」からも読み込める(`AdminView`の`handleApplyTypeFromJson`)。こちらは既存の`spotTypes.applySettings`(PATCH `/api/spot-types/[id]`)をそのまま使ってlabel/settings/series/categoriesを上書きする(PATCHの`label`は元々`settings`専用だったこのエンドポイントに追加した省略可能フィールドで、指定時のみ`spot_types.label`列をUPDATEする)。keyの変更だけは影響が大きい(URLの`/[type]/`セグメント・`app_settings.active_spot_type_id`・地図の表示位置記憶等、あらゆる箇所がkeyで紐づいているため)ため意図的にサポートせず、JSONのkeyが現在開いている種別のkeyと一致しない場合は何も反映せずエラーにする。

`spots.series`(1スポットに1つ・nullable text)/`spots.categories`(1スポットに複数・`text[]`)はどちらも自由入力で、`spot_type = 'tourist'`のときのみtravel-log-data/README.mdに記載のシリーズ基準(A〜E)が意味を持つ(既定値の一覧は`lib/seriesStyle.ts`の`DEFAULT_SERIES_STYLES`と`lib/category.ts`の`DEFAULT_CATEGORIES`、およびそのコメントを参照)。

### 対象地域(`region_scope`)

スポット種別ごとに「対象地域」を持ち、日本以外・世界全体の種別も作れる。`spot_type_settings`の`region_scope`キー(文字列値。`lib/region.ts`)に`'jp'`(既定)・ISO 3166-1 alpha-2の国コード小文字・`'world'`のいずれかを保存し、`resolveRegionScope`で解決する(未設定・不正値は`'jp'`)。DBの`spots.region`列はどのスコープでもそのまま使い、「地域」(日本=都道府県、国指定=州・県、世界=国名)として読み替える。

スコープに連動するのは次の5点:

1. スポット追加・編集フォームの地域欄(`'jp'`のみ`PREFECTURES`のセレクト、他は自由入力+既存値datalist)
2. `/[type]/spots`の地域タブの名称(`regionFieldLabel`: 都道府県/州・県/国)と並び順(`compareRegions`: `'jp'`はJIS順・リスト外の値も末尾に表示、他は五十音順)
3. 地名検索`/api/geocode`の`countrycodes`(`scope`クエリパラメータで渡す。`'world'`は絞り込みなし)
4. 逆ジオ`/api/geocode/reverse`の地域解決(`'jp'`=ISO3166-2コード→都道府県、国指定=state/province/county、`'world'`=国名。レスポンスのキーは`region`)
5. `/[type]/map`初回表示(`'jp'`=従来どおり現在地取得、他=登録スポット全体へfitBounds・スポット0件時は世界全体表示)。地図の表示位置の記憶(`MapView`の`lastViews`。メモリ上のみ)と絞り込み条件の記憶(同`loadSavedFilters`/`saveFilters`。localStorage保存のためアプリを完全に落としても残る。絞り込み中は地図の絞り込みボタンが青くなる)も種別ごとに分けている。現在地追跡モード(GeolocateControlのカメラ追従)中に他画面へ遷移して戻った場合は、位置の復元に加えて追跡モード自体を再開する(`MapView`の`lastTrackingActive`)。なお、PWA(スタンドアロン起動)でアプリを切り替えて戻った場合はページが再読み込みされないため初回表示の現在地取得は走らず、意図的に「開いていた位置をそのまま表示」の挙動にしている(バックグラウンド中に調べ物などで見ていた位置を失わないため)

あわせて`wikipedia_lang`キー(既定`'ja'`、`resolveWikipediaLang`)でスポット詳細のWikipedia検索(`SpotInfoModal`)の言語版サブドメインを種別ごとに切り替えられる。どちらも`/[type]/admin`「スポット種別の設定」の「対象地域とWikipedia言語」フォーム(admin専用)から変更し、PATCH `/api/spot-types/[id]`が値の妥当性を検証する。`PREFECTURES`(47都道府県ハードコード)を「地域の全集合」として使ってよいのは`'jp'`スコープの文脈だけ、という点に注意。

かつては列名が`spots.prefecture`のままだったが、日本以外の種別で意味が合わなくなるため`spots.region`に改名した(CSVインポートのヘッダ・travel-log-data側のCSVも`region`に統一済み。旧名の後方互換は持たせていない)。同時に`municipality`(市区町村)・`official_url`(公式サイト)・`source`(データ出所)の3列も廃止した — `municipality`は`region_scope`と連動しておらず海外スコープでは州・県が抜けて粒度が飛ぶうえ重複判定にも検索にも使っていなかったため、`official_url`は表示コードはあったが入力手段がCSVのみで実データが1件も無かったため、`source`は書き込むだけでどこからも読んでいなかったため。

### スポット種別ごとのON/OFF設定(EAV: `spot_type_settings`)

`reviews_enabled`/`wikipedia_enabled`/`public_visible`は`spot_types`に列を持たず、EAV形式の`spot_type_settings`テーブル(`spot_type_id, key, value` — boolean設定は`'true'`/`'false'`の文字列。同じテーブルに`series_styles`・`region_scope`・`wikipedia_lang`・`categories`のような文字列値のキーも同居する)に保存する。新しい設定を増やす際にDBマイグレーションが要らないようにするための設計で、キー・既定値・表示名は`lib/types.ts`の`SPOT_TYPE_SETTING_DEFAULTS`/`SPOT_TYPE_SETTING_LABELS`に登録するだけでよい(行が存在しないキーは設定ごとの既定値扱い、`getSpotTypeSetting`参照)。`public_visible`は既定`false`(=種別追加当初は非公開・admin/spot_admin限定)で、他2つは既定`true`。`app/api/spot-types/[id]/route.ts`のPATCHは`{ settings: { key: boolean, ... } }`を受け取り`spot_type_settings`へupsertする汎用エンドポイントで、設定を増やしてもAPI自体の変更は不要。`SpotType`型の`settings`フィールド(`key→value`の文字列マップ)は`lib/spot-types-query.ts`の`SPOT_TYPE_SELECT`(`spot_type_settings`をjsonbに集約するSELECT共通部品)を使うクエリでのみ埋まる点に注意(`select * from spot_types`だけでは`settings`は付与されない)。

### シリーズ(`series`)とその見た目(`series_styles`)

かつて「ランク」(`spots.rank`・`rank_styles`・`RankBadge`等)と呼んでいた概念は、`spot_types`が増えて序列でない使い方(並列の区分をシリーズとして持つ種別)が主になったため、**`series`(シリーズ)に全面改名した**(DB列・API・型名・UI表記・ファイル名すべて。後方互換は持たせていない)。


シリーズの一覧・見た目(色・縁取り線の色・地図ピンの大きさ・ラベル)もスポット種別ごとにJSONで持つ(`lib/seriesStyle.ts`)。値がbooleanではないため`SpotTypeSettingKey`の仕組みとは別扱いで、`spot_type_settings`の`series_styles`キー(`SERIES_STYLES_SETTING_KEY`)にJSON文字列(`SeriesStyleDefinition[]`)を保存する。行が無い・parse失敗時は`DEFAULT_SERIES_STYLES`(観光地の現行A〜E配色)にフォールバックする(`resolveSeriesStyles`)。配列の並び順がそのままシリーズの並び順(`getSeriesOrder`、旧`lib/seriesStyle.ts`の`KNOWN_ORDER`ハードコードの後継)になり、`app/api/spots/route.ts`のページング一覧もSQLの`array_position`でこの並びをそのまま使う(旧CASE文のハードコードは廃止)。

ラベルは文字列または`{ image: base64 dataURL }`のどちらか(`isImageLabel`で判定)。`textColor`は省略可で、省略時は`autoTextColor`が背景色の明度から白/濃色を自動選択する。地図ピン(`lib/pinIcon.ts`の`ensurePinImage`、画像ラベル読み込みのため非同期)・バッジ(`components/SeriesBadge.tsx`、Tailwindの動的クラスはJITに拾われないため常にinline styleで色を当てる)・ミニマップ(`components/MiniMap.tsx`)・絞り込みチップ(`components/FilterBar.tsx`)はいずれも`useSeriesStyles(typeKey)`フック(`/api/spot-types`の結果から解決、GETキャッシュにより同一ページでの重複リクエストなし)経由でこの配列を受け取って描画する。非公開スポット(`status='private'`)は縁取り線の色はそのまま破線にするだけで、色・大きさ・ラベルはシリーズと同じにする(公開スポットの縁取りも常に実線で描く。旧実装は非公開のときしか縁取り自体を描いていなかった点の修正でもある)。

`app/api/spot-types/[id]/route.ts`のPATCHの`settings`は文字列値(`series_styles`)も受け付けるよう`boolean | string`に拡張し、保存前に`parseSeriesStyles`で妥当性を検証する。管理画面からのスポット種別JSON作成(`SpotTypeDefinitionFile`)の`series`フィールドもこの形式で、省略時・手入力フォームでの追加時はDEFAULT_SERIES_STYLESのままになる。

### カテゴリ(`categories`)

**1スポットは複数のカテゴリを持てる**(`spots.categories`は`text[]`。かつては単数の`spots.category text`だった)。絞り込みはOR条件で、選択中のカテゴリのいずれかを持つスポットが通る(`FilterBar`の`passesFilters`)。CSV・訪問記録エクスポートでは`categories`という1列にパイプ区切り(`CATEGORY_SEPARATOR`)で書く — カンマだとCSVの区切りと衝突して値全体の引用が要るため(`parseCategoryList`/`formatCategoryList`)。CSVに`categories`列自体が無い場合は、`key`列と同じく既存スポットのカテゴリを変更しない(全消しを防ぐため)。PATCH `/api/spots/[id]`も同じ理由で、ボディに`categories`が含まれるときだけ更新する(「カテゴリなし」にするには空配列を明示的に送る)。

カテゴリの一覧(種別ごとに使える値の定義)も同じパターンでスポット種別ごとに持つ(`lib/category.ts`)。`spot_type_settings`の`categories`キー(`CATEGORIES_SETTING_KEY`)にJSON文字列(`string[]`。見た目は持たない)を保存し、行が無い・parse失敗時は`DEFAULT_CATEGORIES`(観光地の現行カテゴリ、旧`lib/types.ts`の`CATEGORIES`ハードコードの後継)にフォールバックする(`resolveCategories`)。明示的に空配列`"[]"`を保存した種別は「定義済みカテゴリなし」の扱い。配列の並び順がカテゴリの並び順(`getCategoryOrder`)で、地図・スポット一覧の絞り込みチップ(`components/FilterBar.tsx`の`SpotFilters.categories`。シリーズ・訪問状況と同じ複数選択+「すべて」チップ、選択肢は実データに存在する値から作る)と、スポット追加・編集フォーム(`AddSpotModal`)の選択チップ(複数選択のトグル。設定の一覧を先頭に、設定外の既存値を後ろに合成し、一覧に無い値は下の入力欄から足せる)がこの並びを使う。取得は`useCategories(typeKey)`フック(`useSeriesStyles`のカテゴリ版)。管理画面`/[type]/admin`「スポット種別の設定」のカテゴリ欄(カンマ・読点区切りで入力、admin専用)と、スポット種別JSON作成の`categories`フィールド(文字列配列)から設定でき、PATCH `/api/spot-types/[id]`が`parseCategories`で妥当性を検証する。`categories`列自体は従来どおり自由入力で、一覧に無い値も動く(並びは末尾)。

### ルート(`spot_routes`/`spot_route_points`)とスポット参照キー(`spots.key`)

スポットを「巡った順」に矢印で繋ぐルート機能(訪問順に意味がある種別向け)。スキーマは`db/init/01_schema.sql`(他のテーブルと同じファイル)。`spot_routes`(種別ごとのルート名、`(spot_type_id, name)`一意。加えて色分け・絞り込み連動に使う`series`列)+`spot_route_points`(route_id, seq, spot_id)の2テーブルで、経由地はスポット削除時にFKカスケードで点だけ抜け、ルートは残る。公開スポットの全削除(purge)はルートも丸ごと消し、種別削除は`spot_types`へのFKカスケードで消える。

ルートのデータはtravel-log-data側の`<スポットキー>/routes.csv`(列: `route,series,seq,spot_key`。`series`は省略可)に置き、`/[type]/admin`の「ルート(巡った順の矢印)のインポート」から取り込む(spot_admin/admin可)。`spot_key`がスポットを指すために`spots.key`列(種別内一意・nullable。`spots (spot_type_id, key)`の部分uniqueインデックス)を追加してあり、スポットCSVの省略可の`key`列で設定する。名前・座標のような自然キーではなく明示キーにしたのは、改名・座標修正でルートの参照が壊れないようにするため。`AdminView`のルートCSVインポートは全行を検証(未知のspot_key・seq重複・経由地1件以下はエラー)してから、既存と経由地の並びが同一のルートをスキップしてPOST `/api/routes`(ルート名ごとに経由地を丸ごと置き換えるupsert)に送る。個別ルートの削除はDELETE `/api/routes/[id]`。

地図(`MapView`)はGET `/api/routes?type=`の結果を`spot-routes`ソースのLineString+進行方向の矢印アイコン(canvas生成・色ごとに登録)で描画する(ピンのクラスタレイヤーより下)。ルートの`series`が種別のシリーズ一覧にある場合はそのシリーズの`borderColor`で塗り、シリーズ絞り込みにも連動する(シリーズ未指定・一覧に無い値のルートは既定色で表示。`filterVisibleRoutes`)。かつてはルート名(`name`)をシリーズ値と突き合わせていたが、表示名とシリーズは別物(同じシリーズに複数のルートを持たせたい)ため列を分けた。シリーズの絞り込みが「すべて」(未指定)のときは、全ルートの線が重なって地図が見づらくなるためルートを一切表示しない。表示対象のルートの経由地スポットは、スポット自体のシリーズが絞り込みで外れていてもピンを表示する(別のシリーズに属する再訪スポットの上をルートの線だけが通る状態を防ぐ。免除するのはシリーズ条件のみで、カテゴリ・訪問状況の絞り込みは通常どおり適用)。経由地のうち他人の非公開スポット等の見えないスポットはAPI側で除外され、矢印は残りの点を繋ぐ。

これに合わせてCSVインポートの差分更新の突き合わせキーを`name`+`region`+`lat`+`lng`から`name`+`lat`+`lng`に変更し(lat/lngが同じでregionだけ違う使い方は想定しないため。region表記の修正で別スポット扱いになる事故も防ぐ)、さらに`key`一致を最優先の同一判定として、一致した既存行は内容が異なればCSVの内容で上書き更新するようにした(スキップではなく上書きにすることで、CSV側での改名・座標修正・説明文の更新が再インポートだけで反映される。詳細は上記「スポットの新規登録フロー」参照)。

### 公開スポットの全削除・スポット種別の削除

管理画面の`/[type]/admin`にはadmin専用の「公開スポットの全削除」(`app/api/spots/purge/route.ts`)と「スポット種別の削除」(`DELETE /api/spot-types/[id]`、同ファイルのPATCHと同居)がある。前者は`spot_types`の行自体は消さず、対象種別の公開(published)スポットのみを全件削除する(承認待ち・却下・非公開のスポットは残す。CSVで作り直す対象=CSVインポートが取り込む公開スポットに限定するため)。削除される公開スポットに紐づく`visits`/`visit_plans`/`reviews`(FKの`on delete cascade`)・写真ファイルと、対象種別のルート(`spot_routes`。status問わず丸ごと)も一括で消す。後者はstatus問わず対象種別の全スポットを削除(紐づくデータ・写真ファイルの扱いは前者と同じ)した上で`spot_types`の行自体も削除する(「別のスポット種別の管理」一覧には現在表示中の種別も含めて全種別を出すが、現在表示中の種別だけはリンク化・削除ボタンをUI側で出さないことで自分が今開いている種別を誤って消せないようにしている)。後者は`public_visible`がtrue(一般公開中)の種別、または対象種別が`app_settings.active_spot_type_id`(ルート`/`リダイレクトのフォールバック既定)の場合はAPIレベルで拒否する(既定の種別は常にpublic_visible=trueであるため後者は実質前者に含まれるが、防御的に両方チェックしている)。どちらもCSVでデータを作り直す前提の機能で、spot_adminには許可していない(ユーザー管理と同様、他ユーザーのデータを巻き込むため)。ルート`/`アクセス時に開く既定の種別(最後に開いていた種別のCookieが無い・開けないときのフォールバック)の変更は、この一括削除等の管理系操作とは別の独立したセレクトボックス(`app_settings.active_spot_type_id`を更新)として`/[type]/admin`に置いている。

### スポットの新規登録フロー

地図上での右クリック追加、`/[type]/admin`の追加フォーム、CSVインポート(`lib/csv.ts`+`/[type]/admin`)いずれも`app/api/spots/route.ts`の同じ挿入ロジックを通る。status未指定時の既定はroleにより`user`は`private`、それ以外(moderator/spot_admin/admin)は`pending`(`ALLOWED_STATUS_BY_ROLE`が許す範囲でstatusを明示すれば`published`等も選べる)。CSVインポートは`/[type]/admin`(spot_admin/admin専用)からのみ行える経路のため、`AdminView`側で常に`status: 'published'`を明示し、承認待ちを経由せず即座に公開する。それ以外の経路(右クリック追加・追加フォームでの既定)は引き続き承認待ちを通り、承認・却下は`/[type]/admin`側の別ステップで行う。

CSVのヘッダーに`CSV_COLUMNS`(ルートCSVは`ROUTE_CSV_COLUMNS`)に無い列があるときは、`unknownCsvColumns`が検出してインポートを中止する。知らない列は読み飛ばされるだけなので、綴り違いや旧フォーマットのCSV(シリーズ改名前の`rank`/`category`など)を取り込んでもエラーが出ず、該当の値だけが欠けた状態で登録されてしまうため(実際に郵便局データ2.4万件が`series`なしで入り、地図が白いピンになった)。必須列(`name`/`lat`/`lng`/`region`)の存在チェックとは別。

CSVインポートは差分更新で、`AdminView`側が事前読み込み済みの全件(status問わず)と突き合わせる。同一判定は`key`一致を最優先し、keyで見つからなければ`name`+`lat`+`lng`の完全一致で行う。一致した既存行は内容がCSVと異なればCSVの内容でPATCH上書きし(keyが同じなら改名・座標修正もCSVから反映される)、同一ならスキップ、どちらにも一致しない行だけを新規として`app/api/spots/route.ts`に送る(上書きは公開スポットのみ。公開以外=他ユーザーの承認待ち等は編集権限が投稿者本人に限られるため触らない。CSVにkey列が無い場合は既存行のkeyを消さず維持する)。かつてあった「SQLシードとの同期」「重複スポットの削除」機能はこの差分インポートに一本化して廃止した。新規分は`AdminView`側で1,000件ずつのチャンクに分けて順番に送信し、進捗(◯件/◯件)を画面に表示する(1リクエストにまとめると大量データでタイムアウトする恐れがあるため)。

ロールは`admin`/`spot_admin`/`moderator`/`user`の4種類(`lib/types.ts`の`Role`参照)。ユーザー管理(`app/api/admin/users/**`)はadmin専用でspot_adminには許可されない。

### `reviews`と`visits`の非対称設計

`reviews`=公開・本文のみ・`(user_id, spot_id)`ごとに1件(再投稿はupsert)、シリーズの算出には一切使わない。`visits`=非公開・同一ユーザー×同一スポットで複数件可。`visit_plans`(訪問予定・行きたい場所のブックマーク)も非公開で、該当スポットの`visits`が作成されると自動的に削除される。`photos`(text[])にはBase64ではなく、`photos/`フォルダ(docker-composeでbindマウント、`lib/photos.ts`)へ保存したファイルの相対パス`<ユーザーID>/<年>/<月>/<uuid>.<ext>`を保存する。配信は認証付き`/api/photos/[...path]`のみ(先頭セグメント=本人チェック)。

`visits.visited_on`(timestamptz、nullable)は訪問した日時で、未入力なら`null`=表示は「時期不明」(`formatVisitedOn`)。入力は`datetime-local`のため常にローカル時刻で、送信時にISO 8601(UTC)へ変換してから渡す(文字列のまま送るとDB側がサーバーのタイムゾーンで解釈してずれる)。かつては`date`型+`date_precision`列(`day`/`month`/`year`/`unknown`)で「年だけ分かる」等の粒度を持たせ、表示時に年月日を落としていたが、入力の手間に対して使われず廃止した(列ごと削除)。

自分の訪問記録は`/[type]/spots`の「最近の訪問場所」見出し右のボタンからZIPで一括エクスポートできる(`GET /api/visits/export?type=<種別キー>`。typeは必須で、その種別の分のみ。種別横断のエクスポートは意図的に持たない)。ZIPの中身は`visits.csv`(BOM付きUTF-8。訪問のメモ+スポット情報、`lib/csv.ts`の`buildCsv`)と`photos/<uuid>.<ext>`(添付写真。CSVの「写真」列がこのZIP内パスを指す)。ZIP生成は依存を増やさず`lib/zip.ts`の自前実装(無圧縮STORE。中身が圧縮済み画像と小さなCSVのみのため)で、写真ファイルは配信APIと同じく`parseVisitPhotoPath`の所有者チェックを通ったものだけを読む。

### touristのシリーズについて

tourist spotsの`series`(A〜E)はこのリポジトリの外で一度だけ計算されたパイプラインの成果物であり、アプリ側が動的に計算するものではない。Wikipedia(ja)月次ページビュー数に基づく相対順位(パーセンタイル)の機械分類(詳細はtravel-log-data/README.md「各データの出典」参照。シリーズの決め方自体はデータの成り立ちの話のためtravel-log本体のREADMEには置いていない)。手動でスポットを追加する場合も、この基準に沿ったシリーズを付けること。

## 外部データソース(Wikipedia、OSM Overpass/Nominatim、政府オープンデータ等)を扱う際の注意

このリポジトリのスポットデータは、OSM Overpass・Wikipedia API・Nominatimからの取得によって構築・拡張されてきた。この種のデータ収集作業を行う際は、

- 自分でレート制限をかけ、リクエストには識別可能な`User-Agent`(名前+連絡先)を設定すること — Overpass API・Nominatimはこのプロジェクト専有のインフラではなく、無料でコミュニティ運営されているフェアユース前提のサービス
- レンダリング済みHTMLのスクレイピングより、公式API(MediaWiki REST/Action API、Overpass QL)を優先すること
- 政府や第三者のオープンデータには、このアプリのライセンスと整合しない利用制限(非商用限定など)が付いていることが多い。そうしたデータセットの中身(名称・座標・説明文)をそのまま`db/init/`に転記しないこと。せいぜい「抜けているスポットに気づくためのヒント」として使い、実際のデータ(座標・説明文)はライセンス面で問題のない別ソースから取り直すこと
- 一括でスポットを追加した後は、コミット前に既存行との重複(名前一致・近接座標)がないか確認すること — 既存の`tourist`のシードデータにも、過去のインポートで名前だけの突き合わせをすり抜けた重複に近いものが存在する
- 容量の大きいシードデータ(数千〜数万件規模)は、travel-logリポジトリ本体の`db/init/`に直接コミットせず、外部リポジトリ[travel-log-data](../travel-log-data)側に`<スポットキー>/`フォルダ単位のCSVとして置き、`/[type]/admin`の既存CSVインポート機能で取り込む(詳細はtravel-log-data/README.md参照)。`tourist`(観光地)もこの方式で、`spot_types`の行自体はアプリ初期化時に自動で作られるが、スポットデータは他の種別と同様に手動CSVインポートが必要
  - かつては`db/init/tourist_spots.csv`+`db/init/02_tourist_spots.sh`でtravel-log本体に複製・自動投入していたが、`description`列がWikipedia記事冒頭文の無出典転載、`name`/`lat`/`lng`の一部がOpenStreetMap(ODbL)由来だったため、MITライセンスのtravel-log本体からは削除しtravel-log-data側のみに寄せた(過去のコミット履歴からも該当データを除去済み)

## コミット前に

このアプリは実際のユーザーデータ(`users.email`、`visits.memo`、`visits.photos`が指す写真ファイル、`reviews.body`)を保持する。コミット前には、差分にプレースホルダーではない実際の個人情報(実メールアドレス・実名・写真・DBダンプ/エクスポート等)が紛れ込んでいないか確認すること — ローカルのDocker DBに実際のテストアカウントを入れたまま作業していると、気づかず混入しやすい。

コードに変更を加えたら、その変更でREADME.md・CLAUDE.mdの記述(画面のパス、ロール、データ件数、機能の説明など)が古くならないか確認し、必要なら同じコミットで更新すること。特にルーティング構造・ロールの種別と権限・スポット種別ごとのデータ件数・`db/init/01_schema.sql`のスキーマは変更が入りやすく、記述が古いまま放置されがち。
