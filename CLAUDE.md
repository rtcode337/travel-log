# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## コマンド

```bash
docker compose -f docker-compose.dev.yml up --build   # 開発用: アプリ(localhost:7040, next dev+ホットリロード)+Postgres。スキーマ作成・未適用マイグレーションはinitサービスが自動で行う
docker compose pull && docker compose up -d            # 本番用: GHCRのビルド済みイメージ(mainへのpushでGitHub Actionsが自動ビルド)で起動。未適用のマイグレーションはinitサービスが自動で当てる。SESSION_SECRET環境変数が必須(.env可)
npm run dev                                             # Next.js開発サーバー(ローカルPostgresを直接使う場合のみ)
npm run build                                            # 本番ビルド(型チェック込み)
```

`npm run dev`/`npm run build`はどちらも`--webpack`を明示している(Next.js 16の既定バンドラーのTurbopackには、bindマウントされた`data`・`photos`をファイル監視から外す`watchOptions.ignored`相当の設定が無いため。`next.config.ts`のコメント参照)。

どちらにも`predev`/`prebuild`で`npm run copy-maplibre-worker`(`scripts/copy-maplibre-worker.mjs`)が付いており、MapLibreのワーカースクリプトを`node_modules`から`public/maplibre-gl/`へコピーする(生成物のためgit管理外。理由は下記「MapLibreのワーカースクリプト」)。`next dev`/`next build`を直接叩くとこのコピーが走らないため、地図が真っ白になったらまず`npm run copy-maplibre-worker`を実行すること。

3つのcomposeファイル(`docker-compose.yml`=本番用 / `docker-compose.dev.yml`=開発用 / `docker-compose.standalone.example.yml`)はどれもプロジェクト名を`travel-log`に揃えてある。同じホスト上で本番用と開発用を**同時に**は動かせない(ポート7040も`data`も共有しているため、名前を分けても同時起動はできない)。切り替えるときは先に`docker compose -f <今動いている方> down`すること。

`docker-compose.standalone.example.yml`は、`.env`もリポジトリのクローンも置けない環境(NASのコンテナマネージャー等、管理画面にYAMLを貼り付けて起動するタイプ)向けの単体定義の雛形。`docker-compose.yml`との違いは「`${...}`を使わず値を直書きする」「bindマウントを絶対パスで書く」の2点だけで、サービス構成・起動順は同じ。**`docker-compose.yml`側のサービス・環境変数を変えたら、standalone側にも同じ変更を反映すること**(値の直書きぶん古くなりやすい)。**リポジトリに置くのは`.example`の付いた雛形だけ**で、実値を入れてコピーした`docker-compose.standalone.yml`は`.gitignore`してある(`.env.example`と`.env`の関係と同じ。この形式は`SESSION_SECRET`等を直書きするので、雛形を直接編集すると秘密がコミット対象に入る)。

このプロジェクトにテストスイート/テストコマンドは存在しない。リンターも未導入(Next.js 16で`next lint`が廃止された際、代替のESLint導入は見送った — eslint-config-nextの依存チェーンに未修正のbrace-expansion脆弱性(GHSA-mh99-v99m-4gvg)が含まれ、導入するとDependabotの高深刻度アラートが解消不能な形で付くため。エコシステム側の修正後に導入を検討する)。型チェックは`next build`が行う。

### スキーマ変更のルール

DB定義は`db/init/01_schema.sql`の1ファイルにすべてまとまっている(テーブル・索引・トリガー・既定のスポット種別の投入まで)。**このファイルが「現在あるべきスキーマの唯一の定義」**で、追加分を`02_...`のような別の初期化ファイルに切り出す方式は取らない。スキーマを変えるときは常にこのファイルだけを編集すること。

テーブル定義の読める形の一覧とER図は[docs/database.md](docs/database.md)にまとめてある。**DBに変更を入れたら、同じコミットでこの文書も更新すること**(README等と同じく実装に追従させる対象)。

あわせて、**テーブルに変更を加えた場合は同じコミットで`db/migrations/`に移行スクリプトを追加し、本番DBを既存データを保持したまま移行可能にすること**(本番には利用者の訪問記録・写真が入るため、`data/`を捨てる運用はできない)。ファイル名は`<連番>_<内容>.sql`で、ファイル名がそのまま`schema_migrations.version`になる。**`begin`/`commit`と`schema_migrations`へのinsertはスクリプトに書かない**(どちらも`db/entrypoint.sh`が受け持つ)。全文idempotentにすること — 新規DBに対しても一度は実行される。詳細は`db/migrations/README.md`。

適用は`docker compose up`で自動的に行われる(手で流す必要はない。下記「DBの初期化・マイグレーションの流れ」参照)。

移行スクリプトを書いたら、**旧スキーマのダンプに当てた結果が新規作成したDBと一致することを確認する**(`information_schema.columns`・`pg_trigger`・`pg_indexes`を新旧で突き合わせる。手順は`db/migrations/README.md`)。列の並び順だけはPostgresでは既存テーブルに対して変更できないため一致しないが、アプリは常に列名で読み書きしているため影響しない。

### DBの初期化・マイグレーションの流れ

composeは`db` → `init` → `app`の順に起動する。

| サービス | 役割 | タイミング |
|---|---|---|
| `db` | Postgres本体(空のDBができるだけ。スキーマは作らない)。`data`が無ければDockerが作り、所有者はpostgresのエントリポイントが自分で揃える | — |
| `init` | スキーマ本体(`/init/01_schema.sql`)と`/migrations`の未適用SQLを適用し`schema_migrations`に記録するワンショット(`db/Dockerfile`、`db/entrypoint.sh`) | dbのhealthcheck通過**後** |
| `app` | Next.js。`init`が正常終了するまで起動しない | 最後 |

かつてはデータディレクトリの作成とchownを行う`db-init`サービス(prepareサブコマンド)がdbの起動前にあったが、postgresのエントリポイントが同じことを自分でやるため廃止した。「ホスト側にディレクトリが無くても起動できる」が狙いだったものの、それが必要なstandalone環境ほどbindマウント先の自動作成に頼れず、結局あらかじめ作っておく運用になっていた。GHCRのイメージ名(`travel-log-db-init`)はこの名残で、`init`サービスが使い続けている。

スキーマ本体もマイグレーションSQLも`travel-log-db-init`イメージに焼き込まれるため、本番ホストのリポジトリの新旧に関わらず、pullしたイメージの中身がそのまま適用される。マイグレーションが失敗すると`init`が非ゼロ終了し、`app`も起動しないため、古いスキーマのままアプリが動くことはない。

`01_schema.sql`は`schema_migrations`上では`000_init_schema`という名前の「一番先頭のマイグレーション」として扱う。空のDBには実行し、既にテーブルがあるDB(旧方式でinitdbが作ったもの)には実行せず適用済みとして記録するだけにするので、既存の本番DBをそのまま引き継げる。

**`db/init`をdbコンテナにマウントしないのは意図的**。かつては`docker-entrypoint-initdb.d`に`:ro`マウントし、起動前処理が`chmod -R a+rX`をかけていたが、git管理下のファイルのパーミッションをrootで書き換えるため、`01_schema.sql`を更新するとホスト側の`git pull`が失敗するようになっていた。スキーマ本体もイメージ側から流す方式にして解消した(コンテナがホスト側で触るのはgit管理外の`data`だけ)。

開発環境では、スキーマを変えたら`data/`を捨てて作り直すのが手軽(移行スクリプトの検証は下記の使い捨てDBで行う)。

```bash
docker compose -f docker-compose.dev.yml down
rm -rf data/18     # 既存データを捨てる(訪問記録・アカウントも消える)
docker compose -f docker-compose.dev.yml up --build
```

既存データ(`data/`。Postgresの実データで、リポジトリ直下にbindマウントされるが`.gitignore`対象)を消さずにスキーマ・移行スクリプトを試したい場合は、同じPostgresコンテナ内に使い捨てDBを作って流すとよい。

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

NextAuthではなく自前実装。`lib/auth/session.ts`がHMAC-SHA256で署名したCookie(Web Crypto APIのみ使用、外部依存なし)を発行し、`proxy.ts`(Next.js 16で`middleware.ts`から改名されたもの。Node実行)とRoute Handlersの両方で同じロジックにより検証できるようにしている。Cookieには`{ sub: userId, exp }`のみを持たせ、roleは意図的にCookieに含めていない — `lib/auth/current-user.ts`経由で毎リクエストDBから引き直すことで、管理者によるロール変更やDB作り直しが古いCookieのまま反映されない事態を防いでいる。`proxy.ts`は`/login`と`/api/**`、および`/manifest.webmanifest`(ブラウザのmanifest取得は既定でCookieを送らないため、ガードするとPWAとしてインストールできなくなる)以外の全ルートをガードする。

外向きのURL(GoogleログインのリダイレクトURIとCookieの`Secure`属性)は`lib/auth/request-url.ts`が組み立てる。優先順位は`PUBLIC_BASE_URL`(環境変数) → `X-Forwarded-Proto`/`X-Forwarded-Host` → リクエスト自身のURL。リバースプロキシがforwardedヘッダを送らない構成(NAS内蔵のリバースプロキシ等)では、`PUBLIC_BASE_URL`を設定しないとリダイレクトURIが`http://`で組まれてGoogleログインが失敗する。**外向きのURLを組む処理を増やすときは`request.url`を直接使わず、必ずこのモジュール経由にすること**。

### PWA(インストール可能化)

manifest(`app/manifest.ts`、Next.jsのMetadata Files規約で`/manifest.webmanifest`として配信)+アイコン(`public/icons/`のmanifest用3枚と、`app/icon.png`・`app/apple-icon.png`のファビコン/apple-touch-icon)による最小構成のPWA対応で、Service Worker・オフライン対応は意図的に持たない(「デプロイしたのに古い画面が出る」系の問題を避けるため、必要になるまで導入しない方針)。インストール後も中身は同じWebアプリで、認証Cookieもそのまま使われる。iOSはmanifestの`display`/`icons`を見ないため、`app/layout.tsx`の`metadata.appleWebApp`と`app/apple-icon.png`で別途同等の設定をしている。ページ自体のズームは`app/layout.tsx`の`viewport`(`maximumScale: 1`+`userScalable: false`)で無効化してある — 検索窓等への入力フォーカス時の自動ズームで下のタブバーが隠れ、地図表示中はピンチが地図操作に取られてページのズームを戻せなくなるため(地図の拡大縮小はMapLibreのジェスチャなので影響しない)。`/manifest.webmanifest`は`proxy.ts`のガード対象から除外が必要(上記「認証」参照)。アイコンPNGは`scripts/generate-icons.mjs`(sharp使用、依存には含めない)で生成したものをコミットしてあり、デザイン変更時のみ再生成する。iOSのスタンドアロン起動では`target="_blank"`の外部リンクがアプリ内ブラウザ(オーバーレイ)で開かれてしまうため、外部サイトへのリンク(`SpotInfoModal`の「Wikipediaで続きを読む」)はiOS+スタンドアロンのときだけ`x-safari-https://`スキーム(未文書化だがiOSが解釈する)で本物のSafariに切り替えている(`isIosStandalone`)。

### MapLibreのワーカースクリプト(`public/maplibre-gl/`)

地図を作るコンポーネント(`MapView`・`MiniMap`・`SpotRepositionModal`)は`maplibre-gl`を直接importせず、必ず`lib/maplibre.ts`(`export *`での再エクスポート+CSSのimport+ワーカーURLの設定)を経由する。

maplibre-gl 6は、ワーカーURLを指定しない場合`import.meta.url`を起点に`./maplibre-gl-worker.mjs`を解決する実装になった(`src/util/web_worker.ts`の`defaultWorkerUrl`)。ところがwebpackはバンドル時に`import.meta.url`を`"file:///app/node_modules/maplibre-gl/dist/maplibre-gl.mjs"`という文字列へ置き換えるため、`http(s)`で始まらないURLとして弾かれて空文字が返り、`new Worker("", { type: "module" })`=**ページ自身のHTMLをJSモジュールとして読み込む**動作になる。ブラウザは`Failed to load module script: ... non-JavaScript MIME type of "text/html"`で拒否し、ワーカーが起動しないため**タイルもスポットのピンも一切描画されない**(maplibre-gl 5→6の更新で実際に起きた。maplibre-gl 6.0.0時点で上流に修正は無い)。

対策として`scripts/copy-maplibre-worker.mjs`(`predev`/`prebuild`で自動実行)が`maplibre-gl-worker.mjs`と、それが相対importする`maplibre-gl-shared.mjs`を`public/maplibre-gl/`へコピーし、`lib/maplibre.ts`が`setWorkerUrl('/maplibre-gl/maplibre-gl-worker.mjs')`で明示的に渡す。付随して次の2点が要る:

- `proxy.ts`のmatcherが`.mjs`を除外している(認証ガードの`/login`リダイレクトが返るとHTMLをJSモジュールとして読むことになり、同じ症状になるため)
- `Dockerfile`のprodステージが`public`をコピーしている(`output: standalone`は`.next/static`も`public`もコピーしないため。PWAのアイコン`public/icons/`が本番で404していたのも同じ原因)

バージョン固定でコミットせず毎回`node_modules`からコピーするため、maplibre-glを上げても中身がずれない。Turbopackへ移行する場合は、`import.meta.url`の扱いが変わってこの回避が不要になる可能性があるため再確認すること。

### ビルド番号

GitHub Actions(`.github/workflows/docker-publish.yml`)がビルド時に`<JST日時>-<短縮コミットハッシュ>`形式のビルド番号を生成し、`--build-arg BUILD_NUMBER`でDockerfileのprodステージに渡して`ENV BUILD_NUMBER`として焼き込む。`app/[type]/admin/page.tsx`(サーバーコンポーネント)が`process.env.BUILD_NUMBER`を読んで`AdminView`の`buildNumber` propに渡し、管理画面の見出し横に表示する(未設定時は「開発ビルド」)。`NEXT_PUBLIC_`で`next build`時に埋め込むのではなくリクエスト時に環境変数を読む方式にしてあるため、ビルド番号が毎回変わってもNext.jsのビルドキャッシュには影響しない(prodステージは`next build`の後段のため、Dockerレイヤキャッシュも実質壊さない)。

### スポット種別(`spot_types`)の設計

単一の`spots`テーブルを`spot_types`により複数の「種別」で使い回す設計。`tourist`(観光地)がアプリ初期化時(`db/init/01_schema.sql`)に必ず作成される唯一の既定種別で、それ以外の種別は管理者が`/[type]/admin`から追加する(空の種別ではデータが入らないだけで、削除しない限り存在し続ける)。既定種別といっても自動で作られるのは`spot_types`の行だけで、スポットデータ自体は他の種別と同様シードデータを`db/init/`に直接コミットせず外部リポジトリ[travel-log-data](../travel-log-data)にCSVとして置き、`/[type]/admin`のCSVインポートから取り込む(下記「外部データソース」の段落参照)。観光地データの`description`はWikipedia記事冒頭文の引用でCC BY-SA 4.0、`lat`/`lng`はWikipedia記事座標(CC BY-SA 4.0)またはWikidata `P625`(CC0)由来のため、travel-logリポジトリ本体には同梱せずtravel-log-data側でのみ管理・出典表示する。

画面は`/[type]/map`のように`spot_types.key`をURLの動的セグメントとして持ち、種別ごとに独立してアクセスする(ルート`/`アクセス時のリダイレクト先は、最後に開いていた種別のCookie `last_spot_type` — `lib/last-spot-type.ts`。`proxy.ts`が`/[type]/(map|spots|account|admin)`アクセス時に書き込み、`app/page.tsx`が読み取り時に`canViewSpotType`で検証する — を最優先し、無い・開けない場合に`app_settings.active_spot_type_id`の既定へフォールバックする。どちらも他の種別を隠すものではない)。種別の切り替えは`/[type]/map`の**左下の種別チップ(`MapView`。現在の種別名を表示し、タップすると他の種別の一覧メニューが上向きに開き、選ぶと`/[別種別]/map`へ遷移する)**から行う(かつてはアカウントタブ`AccountView`の「別のスポットを見る」一覧だったが、地図から直接切り替えられるよう移した。アカウントタブは現在のモード表示のみ残す)。他の種別が無いときはチップはタップしても何も起きない(現在名の表示だけ)。`public_visible=false`の種別はAPI(`api.spotTypes.list`)がadmin/spot_admin以外には返さないため、一般ユーザーのメニューには公開種別のみ並ぶ。種別ごとの公開範囲は`spot_type_settings`の`public_visible`設定(既定false=admin/spot_admin限定)で制御し、`lib/spot-type-access.ts`の`canViewSpotType`で判定する(`/[type]/admin`だけは`public_visible`に関わらず常にアクセス可)。かつてあった`spot_types.visibility`列(`public`/`admin_only`/`disabled`の3値)は廃止し、`disabled`(誰にも見せない)相当は種別自体の削除で代替するようにした。

新しい種別は`/[type]/admin`のキー+表示名の手入力フォームのほか、`{ key, label, settings?, series?, categories? }`形式のJSONファイルアップロードでも作成できる(`lib/types.ts`の`parseSpotTypeDefinition`でバリデーション、`AdminView`側で`spotTypes.create`→(settings/series/categoriesがあれば)`spotTypes.applySettings`の2段APIコールに分解する。バックエンドに専用エンドポイントは増やしていない)。travel-log-dataリポジトリの`<スポットキー>/settings.json`がこの形式の実例。同じ形式のJSONは、既存の種別に対して「スポット種別の設定」セクション(admin専用)の「JSONファイルから設定を反映」からも読み込める(`AdminView`の`handleApplyTypeFromJson`)。こちらは既存の`spotTypes.applySettings`(PATCH `/api/spot-types/[id]`)をそのまま使ってlabel/settings/series/categoriesを上書きする(PATCHの`label`は元々`settings`専用だったこのエンドポイントに追加した省略可能フィールドで、指定時のみ`spot_types.label`列をUPDATEする)。keyの変更だけは影響が大きい(URLの`/[type]/`セグメント・`app_settings.active_spot_type_id`・地図の表示位置記憶等、あらゆる箇所がkeyで紐づいているため)ため意図的にサポートせず、JSONのkeyが現在開いている種別のkeyと一致しない場合は何も反映せずエラーにする。

`spots.rank`(A〜Eかnull)/`spots.series`(1スポットに1つ・nullable text)/`spots.categories`(1スポットに複数・`text[]`)の3軸については「見た目の軸: ランク・シリーズ・カテゴリ」を参照。series/categoriesは自由入力で、種別ごとに使う値の一覧を設定に持つ(カテゴリの既定は`lib/category.ts`の`DEFAULT_CATEGORIES`)。

### 対象地域(`region_scope`)

スポット種別ごとに「対象地域」を持ち、日本以外・世界全体の種別も作れる。`spot_type_settings`の`region_scope`キー(文字列値。`lib/region.ts`)に`'jp'`(既定)・ISO 3166-1 alpha-2の国コード小文字・`'world'`のいずれかを保存し、`resolveRegionScope`で解決する(未設定・不正値は`'jp'`)。DBの`spots.region`列はどのスコープでもそのまま使い、「地域」(日本=都道府県、国指定=州・県、世界=国名)として読み替える。

スコープに連動するのは次の5点:

1. スポット追加・編集フォームの地域欄(`'jp'`のみ`PREFECTURES`のセレクト、他は自由入力+既存値datalist)
2. `/[type]/spots`の地域タブの名称(`regionFieldLabel`: 都道府県/州・県/国)と並び順(`compareRegions`: `'jp'`はJIS順・リスト外の値も末尾に表示、他は五十音順)
3. 地名検索`/api/geocode`の`countrycodes`(`scope`クエリパラメータで渡す。`'world'`は絞り込みなし)
4. 逆ジオ`/api/geocode/reverse`の地域解決(`'jp'`=ISO3166-2コード→都道府県、国指定=state/province/county、`'world'`=国名。レスポンスのキーは`region`)
5. `/[type]/map`初回表示(`'jp'`=従来どおり現在地取得、他=登録スポット全体へfitBounds・スポット0件時は世界全体表示)。地図の表示位置の記憶(`MapView`の`lastViews`。メモリ上のみ)と絞り込み条件の記憶(同`loadSavedFilters`/`saveFilters`。localStorage保存のためアプリを完全に落としても残る。絞り込み中(シリーズ・カテゴリ・訪問状況が既定と違うとき。`hasActiveFilters`。**訪問状況の既定は「未訪問」のみで「すべて」チップは無い** — 両方選択=全件表示、空選択はUIから作れず、旧保存データの空配列=「すべて」は読み込み時に既定へ倒す)は地図の絞り込みボタンが青くなる。「リセット」ボタンは絞り込みモーダルの見出し行の✕の隣にあり、**地図・スポット一覧とも`FilterBar.tsx`の`FilterResetButton`=絞り込み(シリーズ・カテゴリ・訪問状況)だけを既定に戻す**(`showRoutes`・訪問日・訪問予定リスト・「これだけを表示」・重ね表示は対象外で現在値を維持。スポット一覧は`showReset` propで`FilterBar`先頭に内蔵表示)。地図の訪問日・訪問予定リスト・別の種別を重ねて表示の各セクションの見出し行には個別のリセットボタン(`MapView`の`SectionResetButton`)があり、それぞれ今日/表示しない/重ねないへ戻す(訪問日・訪問予定リストのリセットは、そのセクションの「これだけを表示」も解除する))も種別ごとに分けている。現在地追跡モード(GeolocateControlのカメラ追従)中に他画面へ遷移して戻った場合は、位置の復元に加えて追跡モード自体を再開する(`MapView`の`lastTrackingActive`)。なお、PWA(スタンドアロン起動)でアプリを切り替えて戻った場合はページが再読み込みされないため初回表示の現在地取得は走らず、意図的に「開いていた位置をそのまま表示」の挙動にしている(バックグラウンド中に調べ物などで見ていた位置を失わないため)

あわせて`wikipedia_lang`キー(既定`'ja'`、`resolveWikipediaLang`)でスポット詳細のWikipedia検索(`SpotInfoModal`)の言語版サブドメインを種別ごとに切り替えられる。

`wikipedia_title_source`キー(既定`'name'`、`resolveWikipediaTitleSource`)は**記事を「何の名前」で探すか**を切り替える。`'series'`にすると、スポット名ではなく**そのスポットのシリーズ名**で記事を開く — アニメの聖地のように**1つの作品が各地に複数のスポットを持ち、開きたい記事は場所ではなく作品**という種別向け。`SpotDetailModal`が`spot.series`を`SpotInfoModal`の`primaryTitle`に渡し、**完全一致(リダイレクト解決込み)したときだけ**それを使う。見つからなければ従来どおりスポット名で探し直す — 検索まで許すと、記事にならないシリーズ名(アニメ聖地の「マンガ・アニメ施設」など)で無関係な記事を拾うため。`primaryTitle`で解決したときは**所在地による曖昧さ回避の解決(`resolveDisambiguation`)を行わない**(作品名に対して所在地で絞っても意味がないため)。どちらも`/[type]/admin`「スポット種別の設定」の「対象地域とWikipedia言語」フォーム(admin専用)から変更し、PATCH `/api/spot-types/[id]`が値の妥当性を検証する。`PREFECTURES`(47都道府県ハードコード)を「地域の全集合」として使ってよいのは`'jp'`スコープの文脈だけ、という点に注意。

かつては列名が`spots.prefecture`のままだったが、日本以外の種別で意味が合わなくなるため`spots.region`に改名した(CSVインポートのヘッダ・travel-log-data側のCSVも`region`に統一済み。旧名の後方互換は持たせていない)。同時に`municipality`(市区町村)・`official_url`(公式サイト)・`source`(データ出所)の3列も廃止した — `municipality`は`region_scope`と連動しておらず海外スコープでは州・県が抜けて粒度が飛ぶうえ重複判定にも検索にも使っていなかったため、`official_url`は表示コードはあったが入力手段がCSVのみで実データが1件も無かったため、`source`は書き込むだけでどこからも読んでいなかったため。

### スポット種別ごとのON/OFF設定(EAV: `spot_type_settings`)

`reviews_enabled`/`wikipedia_enabled`/`public_visible`/`rank_enabled`は`spot_types`に列を持たず、EAV形式の`spot_type_settings`テーブル(`spot_type_id, key, value` — boolean設定は`'true'`/`'false'`の文字列。同じテーブルに`series_styles`・`region_scope`・`wikipedia_lang`・`categories`のような文字列値のキーも同居する)に保存する。新しい設定を増やす際にDBマイグレーションが要らないようにするための設計で、キー・既定値・表示名は`lib/types.ts`の`SPOT_TYPE_SETTING_DEFAULTS`/`SPOT_TYPE_SETTING_LABELS`に登録するだけでよい(行が存在しないキーは設定ごとの既定値扱い、`getSpotTypeSetting`参照)。`public_visible`と`rank_enabled`は既定`false`(前者は種別追加当初は非公開・admin/spot_admin限定、後者はランクを使わない)で、他2つは既定`true`。`app/api/spot-types/[id]/route.ts`のPATCHは`{ settings: { key: boolean, ... } }`を受け取り`spot_type_settings`へupsertする汎用エンドポイントで、設定を増やしてもAPI自体の変更は不要。`SpotType`型の`settings`フィールド(`key→value`の文字列マップ)は`lib/spot-types-query.ts`の`SPOT_TYPE_SELECT`(`spot_type_settings`をjsonbに集約するSELECT共通部品)を使うクエリでのみ埋まる点に注意(`select * from spot_types`だけでは`settings`は付与されない)。

### 見た目の軸: ランク・シリーズ・カテゴリ

スポットの見た目と分類の軸は3つあり、**持てる数と決めるものが違う**。

| 軸 | 数 | 値 | 決めるもの |
|---|---|---|---|
| **ランク**(`spots.rank`) | 0か1 | A〜E(アプリに決め打ち) | **色・大きさ**(`lib/rank.ts`) |
| **シリーズ**(`spots.series`) | 0か1 | 種別ごとに自由 | **中身(アイコン・文字)と形**。ランクを使わない種別では**色も**(`lib/seriesStyle.ts`) |
| **カテゴリ**(`spots.categories`) | 0個以上 | 種別ごとに自由 | **絞り込みだけ**(見た目には効かない。`lib/category.ts`) |

**この分け方が今の形になるまでに2回作り直している。** かつては A〜E も作品名・企画名も
同じ「シリーズ」に入れ、シリーズが色・大きさ・ラベルの全部を握っていた。前者は種別を
またいで同じ意味(Aが一番大きく目立つ)なのでアプリに決め打ちできるのに対し、後者は
種別ごとに中身が違うので設定で持つしかなく、1語で説明できなくなっていた。
**段階付けをランクとして切り出し、シリーズは「何のスポットか」だけを表す軸にした。**
一時期はピンの形・アイコンをカテゴリ(`category_styles`)に持たせていたが、
カテゴリは複数選べる=1スポットに複数当たりうるため「配列順で先に一致したもの」という
説明が要り、色(シリーズ)と形(カテゴリ)で出どころも割れていた。**1つしか付かない
シリーズへ寄せた**ことで、見た目の出どころはランクとシリーズの2つだけになっている。

**見た目の解決は`lib/spotStyle.ts`の1か所**(`resolveSpotFace` / `resolveSpotMark` /
`resolveSpotShape`)。地図ピン(`lib/pinIcon.ts`)・バッジ(`components/SpotBadge.tsx`)・
ミニ地図(`MiniMap`)・作成パネルの色玉(`PlanBuildPanel`)が同じ答えを使う ——
別々に決めていると、同じスポットが地図と一覧で違う見た目になって対応が取れなくなる。
`lib/pinIcon.ts`は**何を描くかを決めない**(解決済みの面・中身・形を受け取って描くだけ)。

#### ランク(`rank_enabled`)

**A〜Eと「なし」**の6段階で、値も見た目も`lib/rank.ts`に決め打ちしてある
(種別ごとの設定にしない —— 種別をまたいで同じ意味だから)。

- **色は旧シリーズ設定(観光地のA〜E)から引き継ぎ、大きさだけ底上げした**。
  旧: 26 / 22 / 18 / 15 / 12 → 現: **30 / 26 / 23 / 20 / 18**。Eの12pxは地図上で
  点にしか見えず、ピンの中のアイコンも潰れていた。段の差は詰めて全体を上げてある
- **ランクなしはBと同じ大きさで白**。小さくすると「まだ決めていない」ものが埋もれる
- **種別ごとに使うかを選ぶ**(`rank_enabled`。**既定は使わない**)。使わない種別では
  ランクは常になし扱いで、**大きさはランクなし相当・色はシリーズが決める**
  (作品ごとに色を分けたい種別では、色がシリーズの主要な手がかりになるため)
- 絞り込みは**ランクを使う種別だけ**チップを出す(`FilterBar`・「シリーズから探す」タブ)。
  **値が決め打ちなので、実データに無い段階もチップを出す** —— 「Dが1件も無い」ことは
  押して0件で分かるほうが、選択肢がデータによって増減するより読みやすい
- 一覧の並び(`ランク順`)とページングAPIの並びは**ランク(A→E→なし)→シリーズの定義順**。
  SQL側も`array_position`で決め打ちの順に並べる
- **中身(ピン・バッジの文字)にはランクを出さない。** そこはシリーズの領分なので、
  ランクが読み取れるのは色と大きさだけ —— 代わりに**スポット詳細には「ランクA」と
  文字でも出す**(色の段階を覚えていないと読み取れないため)

#### シリーズの見た目(`series_styles`)

`spot_type_settings`の`series_styles`キーにJSON文字列
(`SeriesStyleDefinition[]` = `{ series, label?, icon?, iconViewSize?, shape?, path?, color?, borderColor?, textColor? }`)
で保存する。**既定は空**(=シリーズ定義なし。かつては観光地のA〜Eが既定だったが、
A〜Eはランクへ移した)。配列の並び順がそのままシリーズの並び順(`getSeriesOrder`)になり、
`app/api/spots/route.ts`のページング一覧もSQLの`array_position`でこの並びを使う。
取得は`useSeriesStyles(typeKey)`フック(`/api/spot-types`の結果から解決。GETキャッシュが
効くので同一ページでの重複リクエストは無い)。**`size`は廃止した**(ランクが決めるため。
古い設定に残っていても読まない)。

- **中身は`icon`(SVGのパス。既定24×24の箱。`iconViewSize`で一辺を変えられる ——
  配布アイコンの`viewBox`は24・48・1000などまちまちなので、パスを書き換えずに
  貼れるようにするため)か`label`(文字列 or `{ image: base64 dataURL }`)**。
  両方あるときは**アイコンを使う**(2つ描くと小さいピンでは潰れる)。
  アイコンの塗りは中身の色(面の色に対して読める色)なので**穴や隙間があってよい**
  (鳥居のように抜けのある絵が描ける。輪郭で形を表す`path`ではこれができない)
- **シリーズ未設定・中身の指定なしは「中身なし」**(色だけの丸)。かつての
  「未設定=白ピンに青丸」の仮想シリーズは廃止した —— 白はランクなしの色として
  使うようになったため
- **訪問済み(緑+✓)のときは中身を出さない** —— 訪問済みかどうかを優先する
- **シリーズの絞り込みチップ(`SeriesFilter`)だけは常にシリーズの色と中身を出す**
  (`resolveSeriesChip`)。あれはスポットの印ではなく、シリーズそのものを選ぶ操作だから。
  中身が無いシリーズはシリーズ名をそのまま出す(空の四角では押せない)
- 非公開スポット(`status='private'`)は**縁取りを破線にするだけ**で、色・大きさ・中身は
  同じにする(公開スポットの縁取りも常に実線で描く)

絞り込みUI(`components/SeriesFilter.tsx`。地図・一覧の`FilterBar`と「シリーズから探す」タブで共用)は
**シリーズの数で見た目が変わる**。`SERIES_FILTER_BUTTONS_MAX`(12)以下なら横並びのボタン列、
それを超えると**検索欄つきの一覧**(`SearchableSeriesFilter`)になる。一覧は選択中のシリーズを
チップで出し、検索欄で部分一致(大文字小文字は無視)に絞った候補をタップでトグルする複数選択で、
一度に描くのは`SEARCH_RESULT_LIMIT`(60)件まで(超過分は件数だけ出す)。かつては単一選択の
プルダウンだったが、アニメ聖地(anime_seichi、685シリーズ)のようにシリーズが数百ある種別では
目当ての値を探せず、複数選択もできなかったため置き換えた。
**シリーズ数が増える種別を足すときはこのUIで選べるかを確認すること。**

スポット追加フォーム(`AddSpotModal`)では**シリーズは自由入力ではなくこの種別の
`series_styles`から選ぶセレクト**にし、**非公開スポット以外(公開・承認待ち)は
シリーズを必須**にしている(`seriesRequired = 実効status !== 'private'`)。
ランクの欄は**`rank_enabled`の種別でだけ**出す(A〜E + なし)。

#### ピンの形(`shape` / `path`)

`shape`は`PIN_SHAPES`(`circle` / `rounded-square` / `diamond` / `pentagon` / `hexagon` /
`castle`)のいずれか(定義は`lib/pinShape.ts`)。**組み込みで足りないときは`path`にSVGの
パス(`d`)を書ける**(`shape`より優先。アプリを直さずに設定側で形を増やせるようにするため)。
**幅100・高さ145の箱**に描き、**箱の下端中央がスポットの位置**(`icon-anchor: bottom`)。
**下がとんがっている必要は無い**。中身は頭の中心(50,50)に描かれるので、**そこは塗りで覆う**
(中身の色は塗りに対して読める色が選ばれるため、空けると地図に直接文字が乗る)。
描画は`Path2D`に組み、自前パスは`addPath`に変換行列を渡して取り込む(`lib/pinIcon.ts`)。
**パスはcanvasで図形を描くだけでスクリプトは走らない**ので設定から受け取ってよいが、
打ち間違いを黙って空のピンにしないよう字面を検査する(`isValidPinPath`。
travel-log-dataの`validate_data.py`にも同じ検査がある)。
**組み込みの形を足すときは`PIN_SHAPES`・`lib/pinIcon.ts`の描画・
travel-log-dataの`SHAPES`の3か所**をそろえること。多角形は**真下に頂点が来る向きに
しない**(ピンのとんがりと重なって輪郭が潰れる)。

実装で踏みやすい点が2つある:

- **`pinIconId`に面・形・中身を全部混ぜること。** `ensurePinImage`は`map.hasImage(id)`で
  早期returnするため、IDに入っていないと**設定を変えても古い画像が使われ続ける**。
  種別の設定は`/api/spot-types`の取得完了までは既定値なので、名前だけをIDにすると
  暫定の見た目のまま固まる
- **重ね表示(別種別を同じ地図に出す経路)にも配線すること。** 本体は
  `useSeriesStyles`/`useRankEnabled`フック、重ね表示は`spotTypes`から直接解決する
  (`overlaySeriesStylesOf`/`overlayRankEnabledOf`)別系統になっている。片方だけ直すと、
  本体は変わるのに重ね表示は古いまま、というちぐはぐになる

PATCH `/api/spot-types/[id]`は`series_styles`・`categories`を保存前に検証する
(検証しないと、壊れたJSONが保存されて黙って既定へフォールバックし、
設定したつもりで効いていない状態になる)。管理画面からのスポット種別JSON作成
(`SpotTypeDefinitionFile`)の`series`フィールドも同じ形式。

### カテゴリ(`categories`)

**1スポットは複数のカテゴリを持てる**(`spots.categories`は`text[]`。かつては単数の`spots.category text`だった)。絞り込みはOR条件で、選択中のカテゴリのいずれかを持つスポットが通る(`FilterBar`の`passesFilters`)。CSV・訪問記録エクスポートでは`categories`という1列にパイプ区切り(`CATEGORY_SEPARATOR`)で書く — カンマだとCSVの区切りと衝突して値全体の引用が要るため(`parseCategoryList`/`formatCategoryList`)。CSVに`categories`列自体が無い場合は、`key`列と同じく既存スポットのカテゴリを変更しない(全消しを防ぐため)。PATCH `/api/spots/[id]`も同じ理由で、ボディに`categories`が含まれるときだけ更新する(「カテゴリなし」にするには空配列を明示的に送る)。

カテゴリの一覧(種別ごとに使える値の定義)も同じパターンでスポット種別ごとに持つ(`lib/category.ts`)。`spot_type_settings`の`categories`キー(`CATEGORIES_SETTING_KEY`)にJSON文字列(`string[]`。見た目は持たない)を保存し、行が無い・parse失敗時は`DEFAULT_CATEGORIES`(観光地の現行カテゴリ、旧`lib/types.ts`の`CATEGORIES`ハードコードの後継)にフォールバックする(`resolveCategories`)。明示的に空配列`"[]"`を保存した種別は「定義済みカテゴリなし」の扱い。配列の並び順がカテゴリの並び順(`getCategoryOrder`)で、地図・スポット一覧の絞り込みチップ(`components/FilterBar.tsx`の`SpotFilters.categories`。シリーズと同じ複数選択+「すべて」チップ(訪問状況は「すべて」チップ無しで既定=未訪問のみ)、選択肢は実データに存在する値から作る)と、スポット追加・編集フォーム(`AddSpotModal`)の選択チップ(複数選択のトグル。設定の一覧を先頭に、設定外の既存値を後ろに合成し、一覧に無い値は下の入力欄から足せる)がこの並びを使う。取得は`useCategories(typeKey)`フック(`useSeriesStyles`のカテゴリ版)。管理画面`/[type]/admin`「スポット種別の設定」のカテゴリ欄(カンマ・読点区切りで入力、admin専用)と、スポット種別JSON作成の`categories`フィールド(文字列配列)から設定でき、PATCH `/api/spot-types/[id]`が`parseCategories`で妥当性を検証する。`categories`列自体は従来どおり自由入力で、一覧に無い値も動く(並びは末尾)。

### 経路(`spot_routes`/`spot_route_points`)とスポット参照キー(`spots.key`)

スポットを「巡った順」に矢印で繋ぐルート機能(訪問順に意味がある種別向け)。スキーマは`db/init/01_schema.sql`(他のテーブルと同じファイル)。`spot_routes`(種別ごとのルート名、`(spot_type_id, name)`一意。加えて色分け・絞り込み連動に使う`series`列、ルート詳細に表示するルート全体の説明文の`description`列、spotsと同じ公開状態の`status`/`created_by`列 — 公開=全員、非公開=作成者本人のみ、承認待ち・却下=本人+moderator以上がGET/DELETEの権限判定に使われる。ルートCSVインポートはスポットと同じく常に`status: 'published'`を明示する)+`spot_route_points`(route_id, seq, spot_id, description — 点側の`description`はその経由地から次の経由地への**区間の説明**(移動手段など)で、次の区間が無い最終地点は常にnull)の2テーブルで、経由地はスポット削除時にFKカスケードで点だけ抜け、ルートは残る。公開スポットの全削除(purge)はルートも丸ごと消し、種別削除は`spot_types`へのFKカスケードで消える。

ルートのデータはtravel-log-data側の`<スポットキー>/routes.csv`(列: `route,series,seq,spot_key,description,leg_description`。`series`・`description`・`leg_description`は省略可。`description`はルート単位=全行同値、`leg_description`は行単位=その行のスポットから次のスポットへの区間の説明で、最終地点の行に書くとインポートエラーになる)に置き、`/[type]/admin`の「ルート(巡った順の矢印)のインポート」から取り込む(spot_admin/admin可)。`spot_key`がスポットを指すために`spots.key`列(種別内一意・nullable。`spots (spot_type_id, key)`の部分uniqueインデックス)を追加してあり、スポットCSVの省略可の`key`列で設定する。名前・座標のような自然キーではなく明示キーにしたのは、改名・座標修正でルートの参照が壊れないようにするため。`AdminView`のルートCSVインポートは全行を検証(未知のspot_key・seq重複・経由地1件以下はエラー)してから、既存と経由地の並びが同一のルートをスキップしてPOST `/api/routes`(ルート名ごとに経由地を丸ごと置き換えるupsert)に送る。個別ルートの削除はDELETE `/api/routes/[id]`。

**公開ルートは公開スポットのダウンロードと同時に取得され、同じIndexedDBキャッシュに保存される**(`useSpotCache`の`publicRoutes`、`StoredSpotCache.routes`。ルート追加後に地図へ反映するには公開スポットの再ダウンロードが必要だが、下記の鮮度チェックが検知して地図を開いたときに再ダウンロードを促す)。

**ダウンロード確認ダイアログは地図(`/[type]/map`)でのみ自動表示する**(`useSpotCache`の`autoPrompt`オプション。スポット一覧`/[type]/spots`は`autoPrompt: false`で呼び、未ダウンロードでもダイアログを出さない=公開スポット抜きの一覧になるだけ)。地図を開いたとき、未ダウンロードなら従来どおり「未ダウンロードです」の確認を出し、ダウンロード済みなら軽量な鮮度チェックAPI `GET /api/spots/last-updated?type=`(公開スポット・公開ルートの最新`updated_at`と件数。件数も見るのは削除だけでは`max(updated_at)`が進まないため)を裏で叩き、キャッシュが古ければ「更新されています」の再ダウンロード確認を出す(`downloadPrompt: 'missing' | 'stale'`)。比較は端末の時計に依存しないよう、ダウンロード時にデータ自体から求めてキャッシュへ保存したサーバー日時`StoredSpotCache.latestUpdatedAt`と行う(持たない旧エントリのみ`downloadedAt`で近似)。チェックの失敗(オフライン等)は黙って無視してキャッシュのまま使う。この端末自身の編集(`applySpotChange`)は`latestUpdatedAt`も進めるため誤検知しない。地図(`MapView`)はこのキャッシュ済み公開ルートを`spot-routes`ソースのLineString+進行方向の矢印アイコン(canvas生成・色ごとに登録)で描画する(ピンのクラスタレイヤーより下)。ルートの線をタップするとルート詳細モーダル(ルート名・ルート全体の説明・全経由地の一覧。経由地は巡った順の番号付きで、2点の間にその区間の説明`spot_route_points.description`を「↓」行として挟む。スポット名のタップでその位置へflyTo)が開く — 2.5pxの線は指で押せないため透明な太い当たり判定レイヤーを重ねてあり、ピン・クラスタと重なる位置のタップはピン側を優先、訪問順の経路(緑)はルートではないため対象外(featureの`routeId`有無で見分ける)。ルートの`series`が種別のシリーズ一覧にある場合はそのシリーズの`borderColor`で塗り、シリーズ絞り込みにも連動する(シリーズ未指定・一覧に無い値のルートは既定色で表示。`filterVisibleRoutes`)。かつてはルート名(`name`)をシリーズ値と突き合わせていたが、表示名とシリーズは別物(同じシリーズに複数のルートを持たせたい)ため列を分けた。カテゴリで絞り込んでいるときも、ルート自体はカテゴリを持たないため「経由地に選択中のカテゴリを持つスポットが1つでもあるルート」を表示する(シリーズと併用時は両方の条件を満たすもののみ)。ただしこの判定に使う経由地は、**そのルートの`series`と同じシリーズのスポットがあればそれだけ**に絞る(`routeOwnPoints`)。乗り換え駅・空港のように複数のルートで共有している経由地に引きずられて無関係なルートまで表示されるのを防ぐためで、`series`が未設定のルート・自分のシリーズの経由地が1つも無いルートは全経由地で判定する(実例: 水曜どうでしょうの`新大阪駅`は「サイコロ1」のスポットだが「サイコロ4」「サイコロ5」「サイコロ6」のルートも通っているため、この絞り込みが無いとカテゴリ=サイコロ1でサイコロ4〜6のルート線まで出ていた)。ルートを表示するかどうか自体は絞り込みモーダルの「ルートを表示」トグル(`SpotFilters.showRoutes`。既定オンで、他の絞り込み条件と同様にlocalStorageへ保存される。ただし絞り込みではないため`hasActiveFilters`には含めず、リセットボタンでも変わらず、絞り込みボタンの青表示にも関与しない。ルートの無い種別ではトグル自体を出さない)だけで決まり、オフなら一切表示しない・オンならシリーズ・カテゴリの絞り込みが無くても全ルートを表示する(かつての「シリーズ・カテゴリで絞り込み中のみ自動表示」ルールは廃止した)。表示対象のルートの経由地スポットは、スポット自体のシリーズ・カテゴリが絞り込みで外れていてもピンを表示する(別のシリーズ・カテゴリに属する経由地の上をルートの線だけが通る状態を防ぐ。免除するのはルートの表示条件と同じシリーズ・カテゴリのみで、訪問状況の絞り込みは通常どおり適用)。経由地のうち他人の非公開スポット等の見えないスポットはAPI側で除外され、矢印は残りの点を繋ぐ。

これに合わせてCSVインポートの差分更新の突き合わせキーを`name`+`region`+`lat`+`lng`から`name`+`lat`+`lng`に変更し(lat/lngが同じでregionだけ違う使い方は想定しないため。region表記の修正で別スポット扱いになる事故も防ぐ)、さらに`key`一致を最優先の同一判定として、一致した既存行は内容が異なればCSVの内容で上書き更新するようにした(スキップではなく上書きにすることで、CSV側での改名・座標修正・説明文の更新が再インポートだけで反映される。詳細は上記「スポットの新規登録フロー」参照)。

### 訪問日(訪問順の経路)

`SpotFilters`の`visitedDate`(`YYYY-MM-DD`のローカル日付)は**絞り込みではなく、地図で「訪問順の経路」を描く対象日**。選んだ日に訪問したスポットを訪問時刻の昇順に緑の矢印で結ぶための日で、`null`=経路を表示しない、既定はその日(今日)。**地図専用**で、スポット一覧(`SpotsView`)は経路を持たないため訪問日のUI自体を出さない(`passesFilters`も`visitedDate`を見ない。旧・第5引数の`visitedDates`は廃止)。

**対象は単日でも期間でも選べる**(`visitedDate`=開始日、`visitedDateTo`=終了日。`null`=単日)。期間を選ぶと日をまたいだ訪問が**1本の経路**になる(旅行の何日ぶんかをそのまま辿れるように)。**列を分けてあるので単日は従来どおり`visitedDate`だけで表せ**、この項目より前に保存された条件もそのまま単日として読める。判定は`isInVisitedRange`(日付キーが`YYYY-MM-DD`なので文字列比較で足りる)。

選び方は**カレンダー**(`components/VisitDateCalendar.tsx`)。絞り込みモーダルの訪問日セクションには**選択中の日(期間)を出すボタン**だけを置き、押すと**カレンダーを別モーダル(z-[60]。絞り込みモーダルのz-50の上)で開く** —— 絞り込みモーダルにカレンダーを直に置くと、他の条件を見るのに毎回その分スクロールすることになるため。**カレンダーは日を選んでも閉じない**(期間は2回のタップで決まるので、1回目で閉じると期間を選べない)。選択はその場で反映されるので、閉じる操作は「閉じる」だけでよい。

**訪問記録のある日には日付の下に緑の点**を打つ(`visitDateSet`。どの日に記録があるか分からないまま総当たりで選ぶことになるのを避けるため。**他のスポット種別への訪問も数える** — 経路が種別をまたぐようになったので、その日を落とすと辿れない)。1回目のタップで開始日、2回目で終了日。既に期間が決まっている状態でのタップは新しい開始日として選び直し(範囲を狭めるのにリセットを挟まずに済む)、開始日より前をタップしたときはその日を開始日にして元の開始日を終了日にする(前方向にも伸ばせる)。同じ日を2回タップしても単日のまま。「今日」「表示しない」はよく使うので、カレンダーの中と絞り込みモーダルの両方に置く。既定値は今日。かつてはセレクト(今日 / 表示しない / 訪問のある日の一覧)だったが、期間指定とデータのある日の可視化のためカレンダーに変えた。「表示しない」(`null`)は`saveFilters`が文字列`"none"`で保存し、`loadSavedFilters`は`"none"`のときだけ`null`=表示しないにする。**「今日」(値が`todayKey()`と一致)は具体的な日付ではなく文字列`"today"`で保存し、読み込み時にその日の今日へ解決する**(日付のまま保存すると翌日に開いたとき前日が選ばれた状態で復元されてしまうため)。日付はその日、それ以外(旧仕様の絞り込みだった頃の`null`・キー欠落・不正値)は今日に倒すため、**既存ユーザーも初回から今日の経路が出る**(`todayKey`/`defaultMapFilters`)。終了日(`visitedDateTo`)は**「今日」のような相対表現を持たず具体的な日付でだけ保存する**(終了日だけ動くと期間の長さが日をまたぐたびに変わってしまうため)。カレンダーで日を選んだとき(`handleSelectVisitDate`)は、対象日(期間)をセットしたうえで**その経路全体が画面に収まるよう`fitBounds`する**(1地点だけならmaxZoomまで寄る。経路が0件・「表示しない」のときは地図を動かさない)。開始日を`null`にするときは終了日も一緒に落とす(残っていると次に日を選んだとき意図しない期間になる)。ユーザーが明示的に選んだときだけ移動し、マウント時の既定(今日)の復元では移動しない。日付キーへの変換は`toVisitDateKey`(`visits.visited_on`はtimestamptzでUTC文字列のため、**必ずローカル時刻で日を切る** — UTCのまま切ると日本時間の朝9時前の訪問が前日になる)。

訪問日が選ばれているとき、`MapView`は**その日の訪問記録を訪問時刻の昇順に矢印で結んだ「訪問順の経路」**を描く(`buildVisitPathsByDay`)。**期間を指定したときは日ごとに別の線にし、日をまたいでスポットを結ばない** —— 宿へ帰って翌朝また出る間の移動は実際には辿っていないので、繋ぐと1日の道のりが読めなくなるため。**線・詳細・Google マップの経路検索のいずれも日ごとに別のルートとして扱う**(フィーチャに`pathDate`を持たせ、タップした線の日ぶんだけを詳細に出す)。かつては期間をまたいで1本に繋いでいた。ルートCSVのルートと同じ`spot-routes`ソース・同じ線/矢印レイヤーに載せるだけなので描画コードは共用で、色だけ`VISIT_PATH_COLOR`(緑`#16a34a`=訪問済みピンの塗りと同じ)にしてルートと区別する。同じスポットへの再訪はそのまま複数回経由地として現れる(行って戻る線になる)が、連続する同じスポットへの訪問は長さ0の線分になり矢印の向きが定まらないためまとめる。日時不明の訪問は除外する。**別のスポット種別のスポットも経路に含める**(訪問予定リストと同じ扱い) — 本体種別で解決できないスポットは`api.spots.get`で座標だけ補完する(`pathExtraSpots`/`pathSpotById`。訪問予定リストと共用の仕組み)。かつては表示中の種別の訪問だけを繋いでいたが、同じ日に別の種別のスポットも回っていると経路がそこで途切れていた。**経路上のスポットでもピンは絞り込みに従う**(下記「ピンの表示と線の表示を分ける」)。

同じ仕組みで、絞り込みモーダルの訪問日の下に**「訪問予定リスト」セレクト**があり、選んだリスト(旅程)のスポットを**リスト順に矢印(紫`PLAN_LIST_PATH_COLOR`=`#9333ea`)で結んだ経路**を描く(`filters.planListId`・`buildPlanListPath`。**訪問済みの経由スポットは経路に載せない** —— 済んだ場所を通り続ける線が残ると次にどこへ行くかが読めないため。リスト自体からは消えない)。訪問日の経路と同じ`spot-routes`ソース/レイヤーに色違いで重ねるだけで(`buildRouteGeoJSON`は色付き経路の配列`extraPaths`を受け取る)、選んだときに`handleSelectPlanList`が経路全体へ`fitBounds`する点も訪問日と同じ(**経路上でもピンは絞り込みに従う**。上記「ピンの表示と線の表示を分ける」)。**現在地(GeolocateControlの青丸)を表示中は、現在地からリスト先頭のスポットまでも線・矢印で結ぶ。この区間だけは青丸と同じ青(`CURRENT_LOCATION_PATH_COLOR`=maplibre-gl既定の`#1da1f2`)で描き、現在地から出ている線だと分かるようにする**(`buildRouteGeoJSON`の`start`に`currentLocation` stateを、`startColor`にこの青を渡すと、この区間が独立したLineStringとして経路の先頭に繋がる。現在地は`geolocate`イベントで更新し(約1m未満の移動は再レンダー抑制のため無視)、青丸ごと消えるOFFへの遷移で忘れる — `trackuserlocationend`はBACKGROUND=青丸が残る遷移でも発火するため、青丸のDOM要素の有無でOFFを見分ける)。リストは`MapView`が`api.visitPlanLists.list`で読み(1件以上あるときだけセレクトを出す)、選択は`loadSavedFilters`/`saveFilters`で保存する(削除済み等で見つからないIDは描画側で無視)。訪問予定リストのセクションのリセットボタンが`planListId`を`null`に戻す(見出し行のリセットは絞り込みのみで触らない)。

### 経路・訪問順・訪問予定リストをGoogle マップで開く

### スポットについて生成AIに聞く(`lib/askAi.ts`)

スポット詳細に**Claude**(Wikipediaアイコンの隣)と**Gemini**(Google マップの経路アイコンの隣)のボタンを置いてある。押すと**質問文を入れた状態**でそれぞれのページが新しいタブで開く。質問文は`buildSpotQuestion`が組み、**所在地と座標を添える** —— 「光明寺」のように同名の場所が各地にあるため、名前だけだと別のスポットについて答えられてしまう。

- **Claudeは`https://claude.ai/new?q=<質問文>`**。`q`はプロンプト欄を埋めるだけで送信はしない公式のパラメータ(送る前に読み返せる)
- **Geminiは`https://www.google.com/search?udm=50&q=<質問文>`(検索のAIモード)**。**`gemini.google.com`はURLでプロンプトを渡せない**(Chrome拡張で補う方法しか無い)ため、同じモデルが答えるAIモードを開いている。gemini.google.com側が対応したら差し替えられるよう、URLの組み立ては`lib/askAi.ts`に寄せてある
- アイコンはWikipedia・Google マップと同じくSimple Icons(CC0)のロゴマークをインラインSVGで持つ
- **Wikipediaボタンと違い、種別の設定で消さない**(`wikipedia_enabled`のような出し分けをしない) —— Wikipedia記事が無いスポットでも何か分かる可能性があるため

### 用語: 「経路」と、記録から引かれる線

**画面の呼称は「経路」**。管理画面/CSV から取り込む、スポットを巡った順に矢印で繋いだデータのこと(`spot_routes`)。**かつては画面でも「ルート」と呼んでいたが、`route` の訳がそのまま「経路」で、記録から引かれる線(こちらも「経路」と呼んでいた)と区別が付かなかったため統一した。**

- **「経路」は保存される実体の名前に専有させる。** スポットと同じく `status`(4値)と `created_by` を持ち、いずれユーザー自身が追加できるようにする余地を残してある(いまの入口はCSVインポートだけ)
- **記録・予定から自動で引かれる線は「経路」と呼ばない。** 緑は**「訪問順」**、紫は**「訪問予定リスト」**。どちらも線そのものは保存せず、訪問記録・旅程から毎回組み立てる
- **地図に描くこと自体は「経路表示」、線をタップして出る画面は「経路詳細」**(3種共通の器。中で `kindLabel` が「経路 / 訪問順 / 訪問予定リスト」を出し分ける)
- **DB・CSV・コードの識別子は `route` のまま**(`spot_routes`・`routes.csv`・`showRoutes`・`filterVisibleRoutes`)。表示名の変更でデータリポジトリ(travel-log-data の各種別が持つ `routes.csv`)や取り込み側まで巻き込まないため。**コード内のコメントも `route` 由来の語のままにしてある**ので、読むときは「ルート=経路(実体)」と読み替える

### ピンの表示と線の表示を分ける

**ピン(スポット)は絞り込み(シリーズ・カテゴリ・訪問状況)と非表示(`spot_hides`)に全部従う。ルートにも経路にも例外を作らない。** かつては「線が通っているのにピンが無い」のを避けるため、表示中ルートの経由地(シリーズ・カテゴリのみ免除)と経路のスポット(全条件を免除)をピンの絞り込みから外していたが、**どのスポットがなぜ出ているのかを絞り込みから読めなくしていた**ためやめた。判定は本体(`MapView`のピン生成)と重ね表示で同じ形の1式だけ。

**線(ルート・経路)は逆に、経由地が絞り込み・非表示で消えてもそのスポットを通る形のまま描く。** 道のりが実際と違う形に歪むのを避けるため。構造上そうなっている —— ルートの線は`route.points`の座標から引き、経路は`spots`全件(+別種別の補完`pathExtraSpots`)から解決していて、どちらもピンを絞った集合(`filteredSpots`)とは無関係。**ピンを絞る処理でこの2つを混ぜないこと。**

例外は**「これだけを表示」だけ**(`filters.isolate`)。その経路のスポットだけを残す表示モードで、**絞り込みより優先する** —— 絞り込みも重ねると、訪問状況の既定(未訪問のみ)では訪問順の経路が1件も残らず、選んでも何も出ないことになるため。

ルート・訪問順の経路・訪問予定リストのような「巡る順に並んだスポット列」は、Google マップの経路検索(Maps URLs の`dir`)にそのまま渡して開ける(`lib/googleMaps.ts`の`buildGoogleMapsRouteUrl`+`components/GoogleMapsRouteLink.tsx`)。**出発地(origin)は現在地**で、スポットは**最後の1件が目的地(destination)、それ以外が経由地(waypoints)**になる。置き場所は地図のルート・経路の詳細モーダル(`MapView`の`routeDetailView`。ルートCSVのルート/訪問順の経路(その日ぶん)/訪問予定リストの経路すべて)と、訪問予定リストの詳細(`VisitPlanListDetailModal`。`/[type]/spots`とスポット詳細の「訪問予定」から開くもの)。**訪問予定リストは訪問済みの経由スポットを外して渡す**(地図の経路と同じ扱い)。詳細は**見出しの上に何の線か(`kindLabel`=「ルート」/「訪問順の経路」/「訪問予定リスト」)を必ず出す** —— 3種を同じ見た目のモーダルで出しているため、種類が分からないと今どれを見ているのか分からなくなる。各地点には**ランク(シリーズ)のバッジ**も出す(`pointBadge`)。バッジは**そのスポットが属する種別のシリーズ設定**で描く —— 経路には別種別のスポットが混じるので、本体の設定を当てると色もラベルもずれる(手元に無いスポットは出さない)。**詳細のスポット名をタップすると、その位置へ`flyTo`したうえでそのスポットの詳細モーダルを開く** —— 一覧から辿ったときに「そこが何なのか」を見に行くまでを1タップで済ませるため。詳細の出し分けはピンのタップと同じで、本体種別のスポット(`spotById`にある)なら通常のモーダル、別種別なら読み取り専用の方を開く。かつては先頭のスポットを出発地にしていたが、今いる場所からそこまでの経路が出ず使い物にならないため現在地に変えた。

現在地は`lib/useRouteOrigin.ts`の`useRouteOrigin`(スポット詳細の単一スポットへの経路リンクと共通)で取る。**位置情報の権限が既に許可されているときだけ**`getCurrentPosition`する — モーダルを開いただけで権限ダイアログを出さないため。取れなければ`origin`を付けずに開き、Google マップ側の判断(多くの場合は現在地)に委ねる。

Maps URLsの`waypoints`は9件までのため、それを超える経路は**並び順のまま等間隔に間引いて**渡し(最初と最後のスポットは必ず残る=間引きの添字が両端を含むため)、省いた件数をリンクの下に注記する(黙って切り捨てない)。スポット0件のときはリンク自体を出さない(現在地が出発地のため、**1件だけでも経路になる**)。座標のみを渡し、スポット名は渡さない(名前で検索されて別の場所に解決されるのを防ぐため)。

### 同じ座標に重なったピン(`stack`と「+N」バッジ)

スポットのクラスタsourceは`clusterMaxZoom: 16`のため、**それより拡大するとクラスタが解け、座標が同じスポットのピンは完全に重なる**。上のピンしかタップできず、下にスポットがあること自体に気づけない。アニメ聖地のように「同じ自治体を代表点にした行が複数ある」種別で顕在化する。

対策は2つで、どちらも本体のクラスタレイヤーのみ(重ね表示側には入れていない):

- `buildClusterGeoJSON`が**同じ座標のスポット数を`stack`プロパティ**に持たせ(`stackKey`が小数第6位=約0.1mまで見て集計)、`STACK_BADGE_LAYER_ID`のsymbolレイヤーがピンの右肩に**「+N」(Nは隠れている件数)**を出す。`showClusterLayers`の表示切り替え対象にも含めること
- `UNCLUSTERED_LAYER_ID`のクリックで`e.features`が複数あるとき(=タップ位置に複数のピンが重なっている)は、先頭を開かず**「この地点のスポット」一覧**(`stackSpotIds` state)を出してどれを開くか選ばせる。選ぶと通常どおり`handleSpotSelect`に流れるため、作成モード中の追加確認にもそのまま繋がる。**一覧は横幅を`max-w-sm`に留める一方、高さは`max-h-[85vh]`まで使う**(重なりが数十件になる種別があるため、件数が多いときに画面の高さいっぱいまで伸ばし、はみ出す分だけ一覧側をスクロールさせる)

座標を少しずらして描く案は採らない(位置を偽ることになるため)。

### 別スポット種別の重ね表示(地図)

地図の絞り込みモーダルの「別の種別を重ねて表示」のチェックボックス一覧で別の種別を選ぶと、その種別の公開スポットとルートを**半透明で**現在の地図に重ねられる(`MapView`の`overlayIds(種別キー)`が返すsource/layer群)。**複数の種別を同時に重ねられる**(選択は`overlayTypeKeys`の配列で、**選んだ順がそのまま描画順**=後から選んだものが上。source/layerのIDも`overlay-spots:<種別キー>`のように種別ごとに分けて作る)。データ(スポット・ルートとも)はその種別の**ダウンロード済み公開スポットキャッシュ**(IndexedDB、`readSpotCacheDb`。公開ルートも同時に保存されている)から読み、種別ごとに`overlayData`(スポット+ルート)・`overlayFilters`(絞り込み)のMapで持つ。未ダウンロードの種別を選んだ場合は「ダウンロードしますか?」の確認を出し、OKならその場でダウンロードしてキャッシュへ保存し(`useSpotCache`は表示中の種別に固定のため、別種別用に切り出した`downloadSpotCacheFor`+共通の進捗ダイアログ`DownloadProgressDialog`を使う。保存されるキャッシュはその種別の地図・一覧でもそのまま使われる)、そのまま重ねて表示する。キャンセル・失敗時はその種別の選択を解除する。保存済み選択の復元時にキャッシュが無かった場合(後からキャッシュを削除した場合)だけは、地図を開いただけで突然ダイアログが出ないよう従来どおり黙ってその種別の選択を解除してメッセージを出す(自分で選んだ直後かどうかは`overlayPromptKeysRef`で見分ける)。選択は表示中の種別ごとにlocalStorage(`travel-log:map-overlay:<種別キー>`)へ**キーのJSON配列**で保存する(単一種別しか重ねられなかった頃の生のキー1つも読める)。重ねるのをやめた種別のレイヤーは削除せずデータを空にして残す(`clearOverlayData`。重ね直しが軽く、クリックハンドラの解除も要らない)。

重ね表示のクラスタ(まとまりの円)は、本体の青ではなく**重ね先の種別の先頭シリーズの色**で塗って見分けられるようにしている(`resolveSeriesStyles`の結果の先頭要素の`color`。数字の文字色は`autoTextColor`で自動選択。シリーズ設定が空配列の種別のみ未知シリーズのピンと同系のグレーにフォールバック)。重ね表示側の絞り込み・ルート表示のオン/オフは種別ごとに、**その種別の地図でユーザー自身が保存した設定**(`loadSavedFilters`)に従う(現在の種別の絞り込みとは独立。経路の線そのもの(緑・紫)は本体のルートレイヤーが種別をまたいで1本に描くため、重ね表示側では描かない)。**ピンの絞り込み・非表示は重ね表示側でも本体と同じ規則で、経路・ルートのメンバーも例外にしない**(上記「ピンの表示と線の表示を分ける」)。「これだけを表示」中も重ね表示は消さず、その経路のメンバーだけを残す(かつては訪問順の経路の注視で重ね表示を全部消していたが、経路が種別をまたぐようになって前提が崩れた)。この設定を編集しやすいよう、重ね表示セクションの各種別の行の右端に「絞り込みを編集」ボタン(その種別が選択済みでダウンロード済みのときだけ表示)があり、**種別を切り替えず現在の地図の上にモーダル(`overlayFilterTypeKey`)を重ねて**その種別の絞り込みを編集できる。モーダルは本体と同じ`FilterBar`を、その種別のスポット(`overlayData`)・シリーズ設定(`overlaySeriesStylesOf`)・カテゴリ設定(`overlayCategoriesOf`)で表示する(訪問日=訪問順の経路は表示中の種別専用のため重ね表示側の編集には出さない。シリーズ・カテゴリ設定は種別ごとに要るため、1種別ぶんしか解決できない`useSeriesStyles`/`useCategories`フックではなく取得済みの`spotTypes`から直接解決する)。変更は`setOverlayFiltersAndSave`がその種別のlocalStorageへ保存しつつ`overlayFilters`stateへ反映するため、重ね表示の描画にも即座に反映される。かつてはこのボタンが`/[重ね先の種別]/map?filter=1&from=<現種別キー>`へ遷移して種別を切り替える方式(遷移先の絞り込みモーダルを最初から開き、`from`の「元の地図に戻る」で戻る)だったが、切り替えずに編集できるモーダル方式に変えた。レイヤーは常に本体より上に置き(`moveOverlayLayersToTop`。全種別のルートを先に、全種別のピンを後に上げるため、どの種別のピンも全種別のルートより上になる)、タップの優先順位は「重ね表示のピン > 本体のピン > 重ね表示のルート > 本体のルート」(`hasFeatureAt`で上位が吸ったタップを下位に渡さない)。重ね表示同士は描画順で上にある種別が優先する(`higherOverlayKeys`。クリックハンドラはレイヤー作成時に一度だけ束縛されるため、そのときどきの重ね表示の状態は`overlayKeysRef`から読む)。

重ね表示のスポットをタップすると読み取り専用のスポット詳細(`SpotDetailModal`の`readOnly`prop。スポット自体の編集・削除・承認/却下や非表示の切り替えを出さず、「地図で開く」の代わりに元のスポット種別の地図へのリンク「「◯◯」の地図で開く」を出す)、ルートをタップすると本体と共用のルート詳細モーダルが開く。読み取り専用でも**訪問記録**(`allowVisitRecording`)と**訪問予定リストへの追加**(`allowPlanList`)だけは行える — どちらも対象は**今開いている地図の種別**(URLの`[type]`)で、重ねられた側の種別のリストは扱わない(リストの経由スポット`visit_plan_list_items`は種別非依存のため、別種別のスポットもそのまま現在の種別の旅程に混ぜられる。地図の作成モードで別種別のピンから追加できるのと同じ)。「「◯◯」の地図で開く」は`?spot=<id>&from=<今表示中の種別キー>`で遷移し、遷移先の地図は`from`がある間、左下の種別チップの上に「← 「◯◯」の地図に戻る」リンクを出す(`/[from]/map`への遷移のみで、元いた表示位置は種別ごとの`lastViews`がそのまま復元する。`?spot=`処理後のURL整理でも`from`は消さずに残し、地図タブ以外へ遷移するとリンクは消える)。

### キー一覧を指定しての削除

`/[type]/admin`のadmin専用セクション「キー一覧を指定して削除」(`app/api/spots/delete-by-keys/route.ts`、POST `?type=`+ボディ`{ keys: string[], dryRun?: boolean }`)。`spots.key`を1行1つ書いたテキストファイルをアップロードすると、クライアント側(`AdminView`の`handleDeleteKeysFile`)がファイル本文をキー一覧にパースし、一致する**公開スポットのみ**を削除する。travel-log-data側で「場所ではない記事」等をCSVから外した際に、その`key`の一覧(`<スポットキー>/excluded_candidates/exclude.txt`)をそのままアップロードしてDB側も追随させるための機能 — **CSVインポートは差分更新でCSVに無い行に触らないため、行を消しただけではDBから消えない**。exclude.txtをコピペせずファイルとして渡せるよう、テキストエリア貼り付けではなくファイルアップロードにしている(スポット種別JSONの反映と同じUI)。

- 空行と`#`で始まる行(除外リストのコメント)はクライアント側で読み飛ばす
- **一致しないキーはエラーにせず`notFoundKeys`として返すだけ**。除外リストは追記していく運用で、既に消したキーが毎回含まれるため(毎回ファイル全体を貼れる)
- 一致は`key`が第一だが、**keyが未設定(null)の既存行に限り`name`の完全一致でも拾う**。keyを振る前に取り込んだデータ(観光地の初回投入分など)をキー一覧だけで掃除できるようにするための後方互換で、travel-log-data側のkeyは「スポット名(重複時のみ連番サフィックス)」の規則のため名前で引ける
- `dryRun: true`で件数・該当なしキー・対象名のサンプル20件だけを返す。UIはファイルを選んだ時点でこのdryRunを自動実行し、その結果(削除対象の件数)を確認してからでないと削除ボタンを出さない
- 全削除(purge)と同様、他ユーザーの訪問記録・写真を巻き込むためadmin専用(spot_adminは不可)。写真ファイルもvisitsがカスケードで消える前に集めて削除する

### GitHubリポジトリからの一括取り込み

`/[type]/admin`のadmin専用セクション「GitHubリポジトリからスポット種別取り込み」(`AdminView`の`handleGithubOpen`/`handleGithubApply`)。リポジトリ(`owner/リポジトリ名`、既定`rtcode337/travel-log-data`)を入力して「開く」を押すと、`raw.githubusercontent.com`(mainブランチ固定、CORS可)からブラウザが直接リポジトリ直下の`catalog.json`(`{ "spot_types": [ { "key", "label" }, ... ] }`形式のスポット種別カタログ)を取得して一覧表示する(既存種別かどうかを「上書き」「新規作成」バッジで示す)。一覧から種別を選んで「適用」すると、そのフォルダの `<キー>/settings.json`・`<キー>/spots.csv`・`<キー>/excluded_candidates/exclude.txt`・`<キー>/routes.csv` を取得し、この順に適用する。settings.jsonだけは必須(無ければ中止)で、他は無ければスキップ。種別が無ければ作成し、あればlabel・設定・シリーズ・カテゴリを上書きする(`applyTypeDefinition`。settings.jsonのkeyとフォルダ名の不一致は中止)。**settings.jsonを読む経路は3つある**(GitHub取り込みの`applyTypeDefinition`、JSONアップロードでの新規作成`handleCreateTypeFromJson`、既存種別への反映`handleApplyTypeFromJson`)ので、`parseSpotTypeDefinition`が返すフィールドを増やしたら3つとも`settingsToApply`へ積むこと。取り出し忘れても取り込みは成功扱いのまま進み、その設定だけが黙って落ちる(かつて`category_styles`を足したときに実際に踏んだ)。spots.csv・routes.csvは個別インポートと同じ差分更新ロジックを共通関数(`runSpotsCsvImport`/`runRouteCsvImport` — 個別インポートのハンドラもこれらの薄いラッパー)で対象種別に対して実行し、exclude.txtは「キー一覧を指定して削除」と同じAPIで削除件数の確認ダイアログにOKしたときだけ実行する(キャンセルしても後続のroutes.csvは続行)。routes.csvの検証用スポットはspots.csv適用後に取り直す。バックエンドに専用エンドポイントは無く、既存APIの組み合わせのみ。

### 登録経路(`spots.origin`)とtravel-log-dataへの還元用エクスポート

アプリ利用中に抜け漏れに気づいて画面から手動追加したスポットを、travel-log-data側のCSVへ還元(逆輸入)するための仕組み。`spots.origin`(`'csv'`/`'manual'`、既定`'manual'`)が登録経路を記録し、CSVインポート(`AdminView`)だけがPOST/PATCHで`'csv'`を明示する(APIは`'csv'`の指定をspot_admin/adminに限定)。`spots.key`の有無で代用しない — keyはルート参照用で、手動スポットにkeyを振る将来の機能と両立しないため。既存データはマイグレーション`003_spot_origin_and_deletions.sql`が「key有り=csv」で一度だけ近似した。

あわせて`spot_deletions`(削除の墓標)テーブルに、**DELETE `/api/spots/[id]`(個別削除)で消されたCSV由来(`origin='csv'`)の公開スポット**のkey・name・座標・region・削除者を記録する(行そのものが消えるため値をコピーして残す。`created_at`が削除日時)。purge・キー一覧を指定しての削除・種別削除はtravel-log-data側発の操作のため記録しない。手動追加(`manual`)の削除も、travel-log-data側に元の行が無いため記録しない。

`/[type]/admin`の「travel-log-dataへの還元用エクスポート」(spot_admin/admin)が、①`origin='manual'`の公開スポット(スポットCSVへの収録候補。key列なし=収録時にtravel-log-data側の規則で振る)と、②削除の墓標(exclude.txtへの追記候補、GET `/api/spot-deletions?type=`)を1つのMarkdownにまとめてダウンロードする。**還元作業はClaude Code等が読む前提のため、意図的に機械取り込み可能な形式にしていない**。還元後にkeyを付けたCSVを再インポートすると、一致した行は内容が同一でも`origin='csv'`にPATCHされ(インポートの同一判定が`origin !== 'csv'`を「変更あり」とみなす)、次回のエクスポートから自動的に外れる。

### 公開スポットの全削除・スポット種別の削除

管理画面の`/[type]/admin`にはadmin専用の「公開スポットの全削除」(`app/api/spots/purge/route.ts`)と「スポット種別の削除」(`DELETE /api/spot-types/[id]`、同ファイルのPATCHと同居)がある。前者は`spot_types`の行自体は消さず、対象種別の公開(published)スポットのみを全件削除する(承認待ち・却下・非公開のスポットは残す。CSVで作り直す対象=CSVインポートが取り込む公開スポットに限定するため)。削除される公開スポットに紐づく`visits`/`visit_plans`/`reviews`(FKの`on delete cascade`)・写真ファイルと、対象種別のルート(`spot_routes`。status問わず丸ごと)も一括で消す。後者はstatus問わず対象種別の全スポットを削除(紐づくデータ・写真ファイルの扱いは前者と同じ)した上で`spot_types`の行自体も削除する(「別のスポット種別の管理」一覧には現在表示中の種別も含めて全種別を出すが、現在表示中の種別だけはリンク化・削除ボタンをUI側で出さないことで自分が今開いている種別を誤って消せないようにしている)。後者は`public_visible`がtrue(一般公開中)の種別、または対象種別が`app_settings.active_spot_type_id`(ルート`/`リダイレクトのフォールバック既定)の場合はAPIレベルで拒否する(既定の種別は常にpublic_visible=trueであるため後者は実質前者に含まれるが、防御的に両方チェックしている)。どちらもCSVでデータを作り直す前提の機能で、spot_adminには許可していない(ユーザー管理と同様、他ユーザーのデータを巻き込むため)。ルート`/`アクセス時に開く既定の種別(最後に開いていた種別のCookieが無い・開けないときのフォールバック)の変更は、この一括削除等の管理系操作とは別の独立したセレクトボックス(`app_settings.active_spot_type_id`を更新)として`/[type]/admin`に置いている。

### スポットの新規登録フロー

地図上での右クリック追加、`/[type]/admin`の追加フォーム、CSVインポート(`lib/csv.ts`+`/[type]/admin`)いずれも`app/api/spots/route.ts`の同じ挿入ロジックを通る。status未指定時の既定はroleにより`user`は`private`、それ以外(moderator/spot_admin/admin)は`pending`(`ALLOWED_STATUS_BY_ROLE`が許す範囲でstatusを明示すれば`published`等も選べる)。CSVインポートは`/[type]/admin`(spot_admin/admin専用)からのみ行える経路のため、`AdminView`側で常に`status: 'published'`を明示し、承認待ちを経由せず即座に公開する。それ以外の経路(右クリック追加・追加フォームでの既定)は引き続き承認待ちを通り、承認・却下は`/[type]/admin`側の別ステップで行う。

**スポットの追加フォーム(`AddSpotModal`)には「訪問を記録」の折り畳みがある**(新規追加のときだけ。**名前とよみがなの間**に、青の見出しと薄青の面=「探訪スポットを追加」だった頃と同じ体裁で置く)。開くと訪問記録の入力欄(訪問日時・写真・メモ。口コミは無し)が出て、**開いたまま送信したときだけ**スポット作成後にそのスポットへ訪問記録を1件(`api.visits.create`)つける。**開いたかどうかが記録するかの意思表示**で、畳んだまま送れば入力欄に既定値(現在時刻)が入っていても記録は付かない。訪問記録欄は`VisitFormModal`と共通の`VisitFields`コンポーネント(写真の縮小・Exif撮影日時取得は`lib/visitPhoto.ts`/`lib/exif.ts`)で、スポットの状態(公開範囲)は通常のスポット追加と同じ選択肢。記録したかどうかは`onSaved(spot, visitRecorded)`で呼び出し側へ返す(`MapView`は訪問済み表示・訪問順の経路を取り直す)。

かつては地図の長押し/右クリックメニューに「ここにスポットを追加」と並べて「探訪スポットを追加」という**別の入口**を置き、`AddSpotModal`を`withVisit`propで開いていた。同じ場所・同じ体裁のまま折り畳みにして入口を1つにしたのは、**メニューの段階で「訪問も記録するか」を決めさせていた**ため —— 追加してから記録すると決めることのほうが多く、選び直すにはモーダルを閉じて長押しからやり直す必要があった。

**非公開スポットは`SpotDetailModal`の「位置を修正」から座標をドラッグで直せる**(`SpotRepositionModal`)。ドラッグできる赤マーカーの付いた地図を出し、保存でPATCHする(座標以外は既存値をそのまま送る — PATCHは`name/lat/lng/region/series/description`を無条件に上書きするため、送らないとnullで消える)。公開スポットは編集フォームの緯度経度欄で直す(この機能は非公開のみ)。

CSVのヘッダーに`CSV_COLUMNS`(ルートCSVは`ROUTE_CSV_COLUMNS`)に無い列があるときは、`unknownCsvColumns`が検出してインポートを中止する。知らない列は読み飛ばされるだけなので、綴り違いや旧フォーマットのCSV(シリーズ改名前の`rank`/`category`など)を取り込んでもエラーが出ず、該当の値だけが欠けた状態で登録されてしまうため(実際に郵便局データ2.4万件が`series`なしで入り、地図が白いピンになった)。必須列(`name`/`lat`/`lng`/`region`)の存在チェックとは別。

CSVインポートは差分更新で、`AdminView`側が事前読み込み済みの全件(status問わず)と突き合わせる。同一判定は`key`一致を最優先し、keyで見つからなければ`name`+`lat`+`lng`の完全一致で行う。一致した既存行は内容がCSVと異なればCSVの内容で上書き更新し(keyが同じなら改名・座標修正もCSVから反映される)、同一ならスキップ、どちらにも一致しない行だけを新規として`app/api/spots/route.ts`に送る(上書きは公開スポットのみ。公開以外=他ユーザーの承認待ち等は編集権限が投稿者本人に限られるため触らない。CSVにkey列が無い場合は既存行のkeyを消さず維持する)。かつてあった「SQLシードとの同期」「重複スポットの削除」機能はこの差分インポートに一本化して廃止した。新規分・上書き分とも`AdminView`側で1,000件ずつのチャンクに分けて順番に送信し(新規はPOST `/api/spots`の一括INSERT、上書きはPOST `/api/spots/bulk-update`の一括UPDATE — 公開スポットのみ・spot_admin/admin専用。1件ずつのPATCHはGitHub取り込みのような大量更新でラウンドトリップの積み重ねが重すぎたため一括化した)、進捗(◯件/◯件)を画面に表示する(1リクエストにまとめると大量データでタイムアウトする恐れがあるため)。

ロールは`admin`/`spot_admin`/`moderator`/`user`の4種類(`lib/types.ts`の`Role`参照)。ユーザー管理(`app/api/admin/users/**`)はadmin専用でspot_adminには許可されない。

### `reviews`と`visits`の非対称設計

`reviews`=公開・本文のみ・`(user_id, spot_id)`ごとに1件(再投稿はupsert)、シリーズの算出には一切使わない。`visits`=非公開・同一ユーザー×同一スポットで複数件可。`visit_plans`(訪問予定・行きたい場所のブックマーク)も非公開で、該当スポットの`visits`が作成されると自動的に削除される(**訪問予定リストの側は削除せず`visited_at`で訪問済みにする**。「訪問予定リスト(旅程)」参照)。`photos`(text[])にはBase64ではなく、保存先からの相対パス`<ユーザーID>/<年>/<月>/<uuid>.<ext>`を保存する(`lib/photos.ts`)。配信は認証付き`/api/photos/[...path]`のみ(先頭セグメント=本人チェック)。

**写真の保存先は`PHOTO_STORAGE`環境変数で切り替えられる**(`lib/photoStorage.ts`の`PhotoStorage`インターフェース)。`fs`(既定)はローカルのファイルシステム(docker-composeが`./photos`を`/app/photos`にbindマウント。Docker運用はこちら。`PHOTOS_DIR`で変更可)、`supabase`はSupabase Storage(`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_STORAGE_BUCKET`)。**永続ディスクを持てないホスト(Vercel等のサーバーレスやボリューム無しのコンテナホスト)へ載せるための切り替え**で、DBが`DATABASE_URL`だけで差し替わるのと同じ考え方。Supabase StorageはRESTが素直なのでSDKを足さず素の`fetch`だけで実装している(依存を増やさない方針。S3/R2直はSigV4署名が要るため未対応 — 足すならこのインターフェースに実装を1つ追加するだけ)。どの保存先でも公開URLは使わず、必ず認証付き配信ルートから読み出して返す(写真は非公開のため)。`lib/photos.ts`はパスの生成・検証とdata URLのデコードだけを持ち、保存先には依存しない(読み出しは`readVisitPhoto`に集約)。訪問記録はスポット詳細の訪問履歴から後から編集できる(`VisitFormModal`の編集モード=`visit` prop+PATCH `/api/visits/[id]`。写真は「既存の相対パス=残す」「data URL=新規追加」の混在で受け取り、相対パスはその訪問記録が現在持つものに限定して検証、外された写真のファイルはDB更新成功後に削除する。口コミは訪問記録と独立のデータのため編集モードでは入力欄を出さない)。

`visits.visited_on`(timestamptz、nullable)は訪問した日時で、未入力なら`null`=表示は「時期不明」(`formatVisitedOn`)。入力は`datetime-local`のため常にローカル時刻で、送信時にISO 8601(UTC)へ変換してから渡す(文字列のまま送るとDB側がサーバーのタイムゾーンで解釈してずれる)。訪問記録フォーム(`VisitFormModal`)で写真を選ぶと、その写真のExif撮影日時を訪問日時欄に入れるボタンが出る(自動では入れない。複数枚選んだ場合は最も古い撮影日時)。Exifの読み取りは依存を増やさず`lib/exif.ts`の自前実装(JPEGのAPP1から`DateTimeOriginal`、無ければIFD0の`DateTime`だけを読む)で、縮小前の元ファイルから読む — canvasで描き直した時点でExifは失われるため。Exifの日時にはタイムゾーンが無いので端末のローカル時刻として解釈する(datetime-localの扱いと揃う)。Exifが無い・JPEG以外(HEICなど)・壊れている場合は例外を投げずボタンを出さないだけにする。

かつては`date`型+`date_precision`列(`day`/`month`/`year`/`unknown`)で「年だけ分かる」等の粒度を持たせ、表示時に年月日を落としていたが、入力の手間に対して使われず廃止した(列ごと削除)。

訪問記録のエクスポートは**管理者が対象ユーザーを指定して実行する**(下記「訪問記録のエクスポート」)。かつては`/[type]/spots`の「最近の訪問場所」右のボタンから本人がその場でダウンロードしていたが、写真ごとZIPにする処理が重く、実行を管理者に限ってバックグラウンドで作る形に変えた。

### 訪問記録のエクスポート(`export_jobs`)

1ユーザーの訪問記録(メモ+スポット情報のCSV)と添付写真を**全スポット種別ぶんまとめて1つのZIP**にする(`lib/visitExport.ts`。種別ごとに`visits-<種別キー>.csv`、写真は共通の`photos/`。CSVの「写真」列がZIP内の写真パスを指す)。

- **実行できるのは管理者だけ**(`POST /api/exports`に`{ email }`)。他人の訪問記録と写真がまるごと入るため、spot_admin・moderatorには開けていない(あちらはスポットの管理権限であって記録を見る権限ではない)
- **生成はリクエストの外で走らせ、すぐ`running`のジョブを返す**。写真ごとまとめるため件数によっては数十秒以上かかり、待たせるとブラウザ側が先にタイムアウトする。完了・失敗は`export_jobs.status`に書き戻し、画面は実行中だけ3秒ごとに一覧を取り直す
- **ZIPはコンテナ内の`/app/exports`**(ホストの`./exports`をbindマウント)に`<ユーザーID>/<ジョブID>.zip`で置き、DBには相対パスだけを持つ(写真と同じ持ち方)。**`photos/`と分けてある**のは寿命が違うため —— 写真は消したら戻らない記録、ZIPはいつでも作り直せる使い捨て。混ぜると掃除のときに消してよいものと消してはいけないものが並ぶ
- **同じユーザーのZIPは最新1件だけ残す**。古いものは**新しいものが`done`になった時点で**ファイルごと消す(途中で失敗しても前回のZIPは残る)。写真の二重保持でディスクが膨らみ続けないようにするため
- **ダウンロードできるのは管理者と対象ユーザー本人だけ**(`GET /api/exports/[id]/download`)。権限が無い場合も404にして、他人のジョブの存在自体を伏せる。本人の入口はアカウント画面(`AccountView`。出来上がっているときだけ出る。**作成ボタンは置かない**)
- **生成状況は「画面を開いたとき・生成中は3秒ごと・画面が表に戻ったとき」の3つの機会で取り直す**(`lib/useExportJobs.ts`。管理画面とアカウント画面で共用)。**`api.exports.list()`はタブ内のGETキャッシュを通さない**(`request`の`fresh`オプション+`Cache-Control: no-store`) —— `lib/api-client.ts`のキャッシュはpathをキーに最初の結果を持ち続け、書き込み系が成功するまで消えないので、**サーバー側で勝手に進む状態を載せると作成中のまま画面が固まる**(リロードするまで完了に変わらない)。状態が進む口を足すときは同じように`fresh`を付けること
- **コンテナが落ちると`running`のまま残る**。1時間を超えた`running`は画面側で失敗扱いにして出し(`ExportJobsPanel`の`STALE_RUNNING_MS`)、管理画面の削除ボタンで片付ける
- 保存先は**ローカルFSのみ**(`lib/exportStorage.ts`)。写真と違い`PHOTO_STORAGE=supabase`のような切り替えは持たない —— 永続ディスクを持てない環境ではバックグラウンド生成そのものが成立しないため

### 未訪問記録(`visits.unvisited`)と非表示スポット(`spot_hides`)

**未訪問記録**は「訪問したが休みや時間の都合でちゃんと見られなかった(改めて来たい)」「事前の下調べをメモしておきたい」ときの、**訪問済みには数えない訪問記録**。独立したテーブルではなく`visits`の`unvisited`フラグ(boolean、既定false)で、訪問記録と同じ場所(同じフォーム`VisitFormModal`のチェックボックス、スポット詳細の同じ訪問履歴一覧、`/[type]/spots`の「最近の訪問場所」、訪問記録ZIPエクスポートの「未訪問記録」列)に記録される。日時の有無で意味が分かれる:

- **`visited_on`あり=「訪れたが改めて来たい」**。その日の訪問順の経路(`buildVisitPath`は`unvisited`を見ない)に含まれ、訪問予定(`visit_plans`)からも通常の訪問と同じく自動で外れる(訪問予定リストの経由スポットに訪問済みの印が付くのも同じ条件。`VisitFormModal`の`onSaved`が保存済みレコードを渡し、`SpotDetailModal`が出し分ける)
- **`visited_on`なし=「下調べ」**。まだ行っていないため、どの経路にも含まれず(`buildVisitPath`は日付一致で拾うため日時なしは自然に対象外)、訪問予定も外れない(POST `/api/visits`が`unvisited && !visited_on`のときだけ`visit_plans`の削除と訪問予定リストの訪問済みの印をスキップ)。表示は「時期不明」ではなく「下調べ」

どちらも**訪問済みの判定には数えない**: `lib/types.ts`の`countedVisits`(`unvisited`を除いたvisits)をピンの緑色・訪問状況の絞り込み・✓回数・地域別の訪問数・訪問日順ソートの`visitedIds`/`latestVisitDate`算出に使う。それ以外(写真・メモ・Exif・編集・削除・一覧表示)は通常の訪問記録と完全に同じで、一覧では琥珀色の「未訪問」バッジで見分ける。作成は訪問記録フォーム(`VisitFormModal`)内のチェックボックスから(かつてあった専用の「+ 未訪問記録」ボタンは、フォーム内で切り替えられれば足りるため廃止した)。

**非表示スポット**は「公開スポットのうち自分は興味がないもの」をユーザーごとに自分の地図・一覧から隠す設定。`spot_hides`(user_id×spot_idで一意。`visit_plans`と同じトグル構造)で、スポット自体には影響しない。APIは`/api/spot-hides`(GET/POST upsert)と`/api/spot-hides/[spotId]`(DELETE)。切り替えはスポット詳細の最下部のトグル(公開スポットのみ表示)。除外の掛かり方:

- 地図(`MapView`)はピンの絞り込み段階で除外する(`hiddenIds`。`spots`配列自体は削らないので、訪問順の経路・訪問予定リスト・ルートのスポット解決は壊れない)。**ルート・経路に含まれていても例外にしない**(上記「ピンの表示と線の表示を分ける」)。スポットIDで引くユーザーごとの設定のため種別をまたいで共通に効き、重ね表示側にも同じ集合を適用する
- `/[type]/spots`の地域別ドリルダウン(件数・一覧)からはクライアント側で除外し、「シリーズから探す」(サーバーページング)は`GET /api/spots`のページング分岐だけが`spot_hides`をSQLで除外する(**非ページングの全件取得には適用しない** — 管理画面のCSV差分インポート・自分の非公開スポット取得が欠けると困るため)。公開スポットのIndexedDBキャッシュにも手を入れない(非表示の切り替えに再ダウンロードが要らないよう、表示側でのみ除外する)
- 解除の入口は`/[type]/spots`の「非表示にしたスポット」一覧(タップで詳細を開いてトグル)。訪問予定・最近の訪問場所など自分の記録の一覧は明示データのため除外しない

### 訪問予定リスト(旅程)

複数スポットを順序付きでまとめる「訪問予定リスト」(旅程)。1スポットごとの`visit_plans`(行きたい場所のブックマーク)とは**独立**で、`/[type]/spots`の訪問予定欄に個別の予定スポットと**混じって**並ぶ(見出しは0件でも常に表示する)。スキーマは`visit_plan_lists`(種別ごと=`spot_type_id`、`title`・`description`・`start_date`・`end_date`(単日は開始=終了)・`user_id`)+`visit_plan_list_items`(`list_id`・`spot_id`・`seq`・`visited_at`、`(list_id, spot_id)`一意)の2テーブル(`db/init/01_schema.sql`、移行は`migrations/006`と`008`)。**種別ごと**(地図の作成が`/[type]/map`上で行われるため。CLAUDE作成時の判断で種別横断は不可)。

作成フローは、訪問予定欄の「+ 訪問予定リストを追加」→ 基本情報モーダル(`VisitPlanListFormModal`。タイトル・説明・期間)→ **下書きをlocalStorageへ保存**(`lib/planListDraft.ts`。「入力完了」までDBに保存しないため、SpotsView→MapViewのページ遷移をまたいで保持する必要がある)→ `/[type]/map?buildList=1`へ遷移して**地図の作成モード**に入る。作成モードでは`MapView`が右側に`PlanBuildPanel`(リスト名・選択済みスポットの並び替え/削除・「入力完了」)を出し、**ピンのタップを詳細表示ではなく追加確認ダイアログに回す**(`buildModeRef`で`ensureClusterLayers`が一度だけ束縛するクリックハンドラ`handleSpotSelect`の分岐を切り替える)。この確認ダイアログには名前だけでなく**スポットの説明とWikipediaの概要への入口**(スポット詳細と同じ`SpotInfoModal`)を出す —— 名前だけでは入れるかどうか決められないため。**表示にはスポットを`api.spots.get`で取り直す**(`addCandidateDetail`)—— 地図の公開スポットはIndexedDBキャッシュ由来で、容量のため`description`も`spot_type_id`も保存されておらず`expandSpot`がnull・空文字を返すため(`lib/spotCacheDb.ts`)。**空の`spot_type_id`のまま種別を引くと必ず見つからず、Wikipediaの可否が種別の設定ではなく既定値(true)で決まってしまう**ので、取り直しが済むまでボタン自体を出さない(ちらつき防止も兼ねる)。Wikipediaの言語・検索の起点は**スポット自身の種別**の設定で引く(重ね表示のピンから開いたときは今の地図の種別と食い違う)。並び替えはタッチでも動くようポインタイベントの自前実装(ライブラリ非依存。3本線ハンドル)で、**`lib/useDragReorder.ts`に切り出してリスト詳細・経路詳細と共用する**(下記「経由スポットの並び替え」)。「入力完了」で`POST /api/visit-plan-lists`(`{ type, title, description, start_date, end_date, spot_ids }`。spot_idsはseq順)して下書きを消し`/[type]/spots`へ戻る。

一覧APIは`GET /api/visit-plan-lists?type=<キー>`で、各リストの経由スポットを**seq順の`spot_ids`(UUID配列)**と、そのうち訪問済みの**`visited_spot_ids`**として返す(スポット詳細は呼び出し側が保持済みの一覧から解決するため軽い)。この列の作り方は3つのAPIで同じものを使う(`lib/visitPlanListSql.ts`の`PLAN_LIST_COLUMNS`)。リストのタップで`VisitPlanListDetailModal`(タイトル・説明・期間・経由スポット一覧・並び替え・編集・削除)。`GET/PATCH/DELETE /api/visit-plan-lists/[id]`は作成者本人のみ。

**訪問記録を付けても経由スポットはリストから消さず、`visited_at`に日時を入れて「訪問済み」にする**(`POST /api/visits`が、その場所を含む**本人の全リスト**の行を更新する。既に印のある行は上書きしない=最初に行った時刻を残す)。**訪問済みは経路から外れる**(地図の紫の矢印=`buildPlanListPath`、`VisitPlanListDetailModal`のGoogle マップの経路検索)が、リストには残るので「その旅程で何を回ったか」を後から辿れる。かつては行ごと外していた(しかも地図でそのリストを経路表示中のときだけ動いていた)が、旅程の記録が消えるためやめた。**印は手で付け外しできる**(詳細モーダルの各行の「訪問済み / 未訪問」ボタン → `PATCH /api/visit-plan-lists/[id]/items/[spotId]`。記録するほどでもない立ち寄りや誤操作を直せる)。日時なしの未訪問記録(=下調べ)では印は付かない(まだ行っていないため。`visit_plans`を消さない条件と同じ)。**`PATCH /api/visit-plan-lists/[id]`は経由スポットを丸ごと入れ替えるので、`visited_at`を控えてから入れ直す** —— 戻さないと並び替えやタイトルの変更だけで訪問済みが消える。1スポットごとの`visit_plans`は従来どおり訪問記録で削除する(ブックマークは行った時点で役目が終わるため)。

**基本情報モーダルには出口が2つある**。「スポットを選ぶ/編集 →」が上記の地図へ進む経路で、もう一方の**「保存」は経由スポットに触らずその場で保存する**(新規はPOST、編集はPATCH。`onSaved`で呼び出し元が一覧を読み直す)。タイトルや期間だけ直したいときに地図まで行かなくて済むようにしたもので、**編集で「保存」したときは既存の`spot_ids`をそのまま送り直す** —— PATCHは経由スポットを丸ごと置き換える仕様なので、送らないと全部消える。ボタンは下の行に「保存」「スポットを選ぶ →」の2つを並べ、**キャンセルは見出し行の右端の`×`**へ移した(下の行を前へ進む操作だけにするため)。

**回る順番は、作成モードに入らなくてもその場で入れ替えられる**。並び替えの操作(左端の三本線ハンドルをつかんでドラッグ)は`lib/useDragReorder.ts`に切り出してあり、**3か所で共用する** —— 作成モードの`PlanBuildPanel`・リスト詳細(`VisitPlanListDetailModal`)・地図の経路詳細(`MapView`の`routeDetailView`。訪問予定リストのときだけハンドルを出す)。`touch-action: none`はハンドルにだけ当てる(`REORDER_HANDLE_CLASS`。行全体に当てると一覧そのものがタッチスクロールできなくなる)。

- **ドラッグ中は手元の並びだけを入れ替え、指を離した時点で1回だけ保存する**(フックの`onReorder`と`onCommit`)。動かすたびにPATCHすると、1回の並び替えで何度も書き込むことになる。作成モードだけは下書き(localStorage)なので`onReorder`で毎回渡す
- 保存は`PATCH /api/visit-plan-lists/[id]`で、**題名・説明・期間もそのまま送り直す**(PATCHは基本情報も丸ごと受け取る仕様のため、送らないと消える。訪問済みはAPI側が控えて戻す)。失敗したら理由を画面に出し、**保存できていない並びを残さないようサーバーの状態へ戻す**
- **経路詳細で動かせるのは経路に出ている地点だけ**。訪問済み・手元に無いスポットは経路に載らない(`buildPlanListPath`)ので、`spot_ids`の中でその位置を動かさず、出ている分だけを入れ替える(`MapView`の`applyPathOrder`)。全件を並べ替えたいときはリスト詳細の側で操作する
- 経路詳細の行の`key`は位置ではなく**スポットのID**(リスト内で一意)。位置にすると並べ替えのたびに行が作り直され、ポインタの捕捉が外れて指を離すまで追従しなくなる
- ルート(`spot_routes`)と訪問順の経路は**並べ替えない**(取り込み済み・記録済みの事実であって、これから回る順番ではないため)

**編集は作成フローを再利用する**。詳細の「編集」→ `VisitPlanListFormModal`(`edit`propに既存リストを渡して基本情報を初期表示)→ 下書きに`editingId`と既存の`spotIds`を入れて地図の作成モードへ → スポットを足す/外す/並び替えて「更新」で`PATCH /api/visit-plan-lists/[id]`。PATCHは基本情報を更新し、経由スポットは受け取った`spot_ids`で**丸ごと置き換える**(items全削除→seq付きで入れ直し)。作成モードは下書きの`editingId`の有無で「入力完了(新規=POST)」と「更新(編集=PATCH)」を出し分ける(`completeBuild`)。

**作成モード中は、下書きの選択済みスポットを選んだ順に紫の矢印で結んだ経路を地図に描く**(`MapView`の`buildDraftPath`。訪問予定リストの経路表示と同じ`spot-routes`ソース/色で、追加・削除・並び替えに即追従する。保存済みリストの経路表示と同じく、現在地(青丸)の表示中は現在地から下書き先頭のスポットまでも青(`CURRENT_LOCATION_PATH_COLOR`)の線・矢印で結ぶ。線のタップで詳細は開かない — 作成中のタップはピンの追加操作を優先するため`pathKind`を付けない)。編集対象のリスト自身を絞り込みの「訪問予定リスト」経路表示(`filters.planListId`)にしていた場合は、更新前の経路が古い形のまま二重に残らないよう保存済み側は描かない。下書きの経由スポットも**ピンは絞り込みに従う**(線だけがそのスポットを通る)。**作成中パネルの一覧は、本体スポット+重ね表示+補完(`pathExtraSpots`)で名前を解決する**(`buildPanelSpotById`) —— 補完を混ぜないと、線には出ているのにパネルだけ「(読み込み中のスポット)」のままになる(重ねていない別種別のスポットは補完でしか名前が手に入らない)。それでも解決できない行には**理由の説明を`HelpTip`で出す**(取得中 / 削除済み / 他人の非公開スポット / 通信失敗)—— 何が起きているのか画面から分からないため。訪問予定リストの詳細(`VisitPlanListDetailModal`)にも同じ説明を置いてある。本体種別で解決できないスポット(別種別を重ねて追加したもの)は経路表示中のリストと同じ補完(`planListExtraSpots`)で座標を解決する。編集など**スポットが既にある下書きで作成モードに入ったときは、経路全体が見えるよう一度だけ`fitBounds`する**(`buildFitPendingRef`。新規作成で最初のスポットを足したときには動かさない)。

### touristのランクについて

tourist spotsのA〜E(かつては`series`、いまは`rank`)はこのリポジトリの外で一度だけ計算されたパイプラインの成果物であり、アプリ側が動的に計算するものではない。Wikipedia(ja)月次ページビュー数に基づく相対順位(パーセンタイル)の機械分類(詳細はtravel-log-data/tourist/README.md参照。決め方自体はデータの成り立ちの話のためtravel-log本体のREADMEには置いていない)。手動でスポットを追加する場合も、この基準に沿ったランクを付けること。

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
