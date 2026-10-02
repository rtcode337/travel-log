# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## コマンド

```bash
docker compose -f docker-compose.dev.yml up --build   # 開発用: アプリ(localhost:7040, next dev+ホットリロード)+Postgres。スキーマ作成・未適用マイグレーションはアプリが起動時に自動で行う
docker compose pull && docker compose up -d            # 本番用: GHCRのビルド済みイメージ(mainへのpushでGitHub Actionsが自動ビルド)で起動。未適用のマイグレーションはアプリが起動時に自動で当てる。SESSION_SECRET環境変数が必須(.env可)
npm run dev                                             # Next.js開発サーバー(ローカルPostgresを直接使う場合のみ)
npm run build                                            # 本番ビルド(型チェック込み)
```

LAN内の別端末から開発サーバを開くときは`ALLOWED_DEV_ORIGINS`(`.env`)にホスト名・IPを書く。
**1つでも書いたら`localhost`・`127.0.0.1`も一緒に書くこと** —— 書いた時点で
「書いたものだけ」が許可になり、**開発機自身のブラウザから開いても画面が真っ白になる**
(HTMLは200で返るのに`/_next`配下が403で止まりJSが動かないため、原因が分かりにくい)。

`npm run dev`/`npm run build`はどちらも`--webpack`を明示している(Next.js 16の既定バンドラーのTurbopackには、bindマウントされた`data`をファイル監視から外す`watchOptions.ignored`相当の設定が無いため。`next.config.ts`のコメント参照)。

どちらにも`predev`/`prebuild`で`npm run copy-maplibre-worker`(`scripts/copy-maplibre-worker.mjs`)が付いており、MapLibreのワーカースクリプトを`node_modules`から`public/maplibre-gl/`へコピーする(生成物のためgit管理外。理由は下記「MapLibreのワーカースクリプト」)。`next dev`/`next build`を直接叩くとこのコピーが走らないため、地図が真っ白になったらまず`npm run copy-maplibre-worker`を実行すること。

3つのcomposeファイル(`docker-compose.yml`=本番用 / `docker-compose.dev.yml`=開発用 / `docker-compose.standalone.example.yml`)はどれもプロジェクト名を`travel-log`に揃えてある。同じホスト上で本番用と開発用を**同時に**は動かせない(ポート7040も`data`も共有しているため、名前を分けても同時起動はできない)。切り替えるときは先に`docker compose -f <今動いている方> down`すること。

`docker-compose.standalone.example.yml`は、`.env`もリポジトリのクローンも置けない環境(NASのコンテナマネージャー等、管理画面にYAMLを貼り付けて起動するタイプ)向けの単体定義の雛形。`docker-compose.yml`との違いは「`${...}`を使わず値を直書きする」「bindマウントを絶対パスで書く」の2点だけで、サービス構成・起動順は同じ。**`docker-compose.yml`側のサービス・環境変数を変えたら、standalone側にも同じ変更を反映すること**(値の直書きぶん古くなりやすい)。**bindマウントは短い書き方(`"ホスト:コンテナ"`の1文字列)で書く。** 長い書き方(`type: bind`)は**`create_host_path`の既定がかつてfalseだった**(短い書き方でだけ暗黙にtrue)ため、古いDockerでは置き場がホストに無いとマウントできずに落ちる —— 新しい版は既定がtrueなので**新しいDockerでは再現せず、古いDockerを積んだ環境(NAS等の組み込みのコンテナ実行環境)でだけ落ちる**(短い書き方なら古い版でも起動する)。この形を保つために、**3つのサービスとも置き場を同じ`/data`にマウントする**(1本のアンカーを共有できる。YAMLは文字列を連結できないので、ターゲットが分かれると短い書き方では書けない)。dbだけは`PGDATA`を`/data/db/18/docker`に移してそこへ寄せてあり、代わりに空く`/var/lib/postgresql`(postgresイメージの`VOLUME`宣言)には`tmpfs`を当てて匿名ボリュームの量産を止めている。

**リポジトリに置くのは`.example`の付いた雛形だけ**で、実値を入れてコピーした`docker-compose.standalone.yml`は`.gitignore`してある(`.env.example`と`.env`の関係と同じ。この形式は`SESSION_SECRET`等を直書きするので、雛形を直接編集すると秘密がコミット対象に入る)。

このプロジェクトにアプリコードのテストスイート/テストコマンドは存在しない(唯一のテストは`scripts/bootstrap-sql_test.sh`で、Supabase向けの一括SQLがアプリの起動時の適用と同じスキーマを作るかを突き合わせるもの。`db/migrations/README.md`参照)。リンターも未導入(Next.js 16で`next lint`が廃止された際、代替のESLint導入は見送った — eslint-config-nextの依存チェーンに未修正のbrace-expansion脆弱性(GHSA-mh99-v99m-4gvg)が含まれ、導入するとDependabotの高深刻度アラートが解消不能な形で付くため。エコシステム側の修正後に導入を検討する)。型チェックは`next build`が行う。

### スキーマ変更のルール

DB定義は`db/init/01_schema.sql`の1ファイルにすべてまとまっている(テーブル・索引・トリガー・既定のスポット種別の投入まで)。**このファイルが「現在あるべきスキーマの唯一の定義」**で、追加分を`02_...`のような別の初期化ファイルに切り出す方式は取らない。スキーマを変えるときは常にこのファイルだけを編集すること。

テーブル定義の読める形の一覧とER図は[docs/database.md](docs/database.md)にまとめてある。**DBに変更を入れたら、同じコミットでこの文書も更新すること**(README等と同じく実装に追従させる対象)。

あわせて、**テーブルに変更を加えた場合は同じコミットで`db/migrations/`に移行スクリプトを追加し、本番DBを既存データを保持したまま移行可能にすること**(本番には利用者の訪問記録・写真が入るため、`data/`を捨てる運用はできない)。ファイル名は`<連番>_<内容>.sql`で、ファイル名がそのまま`schema_migrations.version`になる。**`begin`/`commit`と`schema_migrations`へのinsertはスクリプトに書かない**(どちらも`scripts/migrate.mjs`が受け持つ)。全文idempotentにすること — 新規DBに対しても一度は実行される。詳細は`db/migrations/README.md`。

適用は`docker compose up`で自動的に行われる(手で流す必要はない。下記「DBの初期化・マイグレーションの流れ」参照)。

移行スクリプトを書いたら、**旧スキーマのダンプに当てた結果が新規作成したDBと一致することを確認する**(`information_schema.columns`・`pg_trigger`・`pg_indexes`を新旧で突き合わせる。手順は`db/migrations/README.md`)。列の並び順だけはPostgresでは既存テーブルに対して変更できないため一致しないが、アプリは常に列名で読み書きしているため影響しない。

### DBの初期化・マイグレーションの流れ

composeは`init` → `db` → `app`の順に起動する。スキーマの適用は`app`自身が起動時に行う。

| サービス | 役割 | タイミング |
|---|---|---|
| `init` | `data/`の下に`db`・`photos`・`exports`を作り、`photos`・`exports`の所有者を実行ユーザーに合わせるワンショット(appと同じイメージをrootで起動) | 最初 |
| `db` | Postgres本体(空のDBができるだけ。スキーマは作らない)。実データは`PGDATA`で`data/db/18/docker`に置く。所有者はpostgresのエントリポイントが自分で揃える | `init`の正常終了後 |
| `app` | 待ち受けの前にスキーマ本体(`db/init/01_schema.sql`)と`db/migrations`の未適用SQLを適用し`schema_migrations`に記録し(`scripts/migrate.mjs`)、そのあとNext.jsを起動する | dbのhealthcheck通過**後** |

**スキーマの適用に専用のイメージとサービスは持たない。** アプリが同じDBへ`pg`で繋いでいる以上、psqlを積んだイメージを別に公開・pullする理由が無いので、`scripts/migrate.mjs`としてアプリ側に置いている。**適用の中身は1か所**で、外部DBへ当てる`scripts/migrate-remote.sh`も同じスクリプトをアプリのイメージで走らせる —— Docker運用とホスティング先とで当たるSQLがずれないため。失敗は`app`が起動途中で落ちて再起動を繰り返す形で見える(理由は`docker compose logs app`の`migrate:`の行)。DBがまだ起きていないだけなら次の回で通る。

**`init`の仕事はディレクトリの準備**(名前はかつてのスキーマ適用用のワンショットと同じだが別物)。**`app`が非rootなので要る** —— postgresが所有者を揃えるのは`db/`だけで、`photos/`と`exports/`は誰も揃えない。bindマウント先がホストに無いとDockerがroot所有で作るので、何もしないと写真の保存で必ず落ちる。自動作成に頼れない環境もあるので、**ホストに用意してもらうのは親の`data/`1つだけ**にしてある(その下の3つは`init`が作る。standaloneのYAMLでも`x-data-dir`1つ)。

スキーマ本体もマイグレーションSQLもアプリのイメージに焼き込まれる(`Dockerfile`のprodステージが`db/init`・`db/migrations`をコピーする)ため、本番ホストのリポジトリの新旧に関わらず、pullしたイメージの中身がそのまま適用される。マイグレーションが失敗すると待ち受けに進まないため、古いスキーマのままアプリが動くことはない。

`01_schema.sql`は`schema_migrations`上では`000_init_schema`という名前の「一番先頭のマイグレーション」として扱う。空のDBには実行し、既にテーブルがあるDB(旧方式でinitdbが作ったもの)には実行せず適用済みとして記録するだけにするので、既存の本番DBをそのまま引き継げる。

**`db/init`をdbコンテナにマウントしないのは意図的** —— コンテナにgit管理下のファイルを触らせると、パーミッションがrootで書き換わってホスト側の`git pull`が失敗する(実際に起きた)。コンテナがホスト側で触るのはgit管理外の`data`だけにする。

開発環境では、スキーマを変えたら`data/`を捨てて作り直すのが手軽(移行スクリプトの検証は下記の使い捨てDBで行う)。

```bash
docker compose -f docker-compose.dev.yml down
rm -rf data/db/18  # 既存データを捨てる(訪問記録・アカウントも消える)
docker compose -f docker-compose.dev.yml up --build
```

既存データ(`data/`。Postgresの実データで、リポジトリ直下にbindマウントされるが`.gitignore`対象)を消さずにスキーマ・移行スクリプトを試したい場合は、同じPostgresコンテナ内に使い捨てDBを作って流すとよい。

```bash
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d postgres -c "create database schema_check"
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d schema_check -v ON_ERROR_STOP=1 < db/init/01_schema.sql
docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d postgres -c "drop database schema_check"
```

全テーブルが`created_at`/`updated_at`を持ち、`updated_at`は共通の`set_updated_at()`トリガーで自動更新される。テーブルを追加したら、対応する`create trigger <table>_set_updated_at`をファイル下部のトリガー定義の並びにも追加すること。



[travel-log-data](../travel-log-data)側の`tourist/spots.csv`(観光地データ全件。列は`name,name_kana,lat,lng,region,rank,series,categories,description,key`)を編集する際は、本番の`spots`/`spot_types`テーブルではなく使い捨てのスキーマで検証すること(このリポジトリの過去のやり方: `create schema lint_check`→`create table lint_check.spots (like public.spots including all)`→`search_path`をそこに向けてCOPYする→`drop schema lint_check cascade`)。シードファイルの検証のために本物の`public.spots`を`truncate`・再投入しないこと。

スポットのシードデータは`db/init/`に置かず、`tourist`を含む全種別のスポットデータを`/[type]/admin`のCSVインポートから手動で取り込む(下記「外部データソース」の段落参照)。

## アーキテクチャ

### バックエンド構成

Next.jsのRoute Handlersのみで、別立てのAPIサーバーは存在しない。`app/api/**/route.ts`が`lib/db.ts`の単一の`pg.Pool`経由で直接Postgresと通信する。`lib/api-client.ts`はフロントエンド側から各Route Handlerを呼ぶための共通ラッパーで、レスポンスを`{ data, error }`に正規化する。

### 環境変数で畳める機能(`lib/features.ts`)

載せる先の都合で成立しない・使いたくない機能を、コードを分けずにホスト側の設定だけで消せるようにしてある。**どれも未設定なら有効**(Docker運用の従来どおりの挙動)。

| フラグ | 畳むもの | 理由 |
|---|---|---|
| `NEXT_PUBLIC_EXPORTS_ENABLED=false` | 訪問記録のZIPエクスポート | 生成が常駐プロセス+永続ディスク前提で、サーバーレスでは成立しない |
| `NEXT_PUBLIC_PHOTOS_ENABLED=false` | 訪問記録への写真の**追加** | 保存先の容量が限られるホスト向け(Supabase無料はストレージ1GB) |

- **APIと画面の両方を必ず塞ぐこと。** 画面だけ隠してもAPIが素通しなら直接叩けば動いてしまい、容量やコストを抑えるという目的が果たせない
- **`NEXT_PUBLIC_`を付けてあるのは、同じ判定をサーバーとブラウザの両方で使うため**(秘密ではなく「機能が有るか」を表すフラグ)。`fs`を読む`exportStorage.ts`・`photoStorage.ts`とは別ファイルにしてあるのは、クライアントコンポーネントから読めるようにするため
- **ビルド時に埋め込まれる**ので、値を変えたら再デプロイが要る

### 認証

NextAuthではなく自前実装。`lib/auth/session.ts`がHMAC-SHA256で署名したCookie(Web Crypto APIのみ使用、外部依存なし)を発行し、`proxy.ts`(Next.js 16で`middleware.ts`から改名されたもの。Node実行)とRoute Handlersの両方で同じロジックにより検証できるようにしている。Cookieには`{ sub: userId, exp }`のみを持たせ、roleは意図的にCookieに含めていない — `lib/auth/current-user.ts`経由で毎リクエストDBから引き直すことで、管理者によるロール変更やDB作り直しが古いCookieのまま反映されない事態を防いでいる。`proxy.ts`は`/login`と`/api/**`、および`/manifest.webmanifest`(ブラウザのmanifest取得は既定でCookieを送らないため、ガードするとPWAとしてインストールできなくなる)以外の全ルートをガードする。

外向きのURL(GoogleログインのリダイレクトURIとCookieの`Secure`属性)は`lib/auth/request-url.ts`が組み立てる。優先順位は`PUBLIC_BASE_URL`(環境変数) → `X-Forwarded-Proto`/`X-Forwarded-Host` → リクエスト自身のURL。リバースプロキシがforwardedヘッダを送らない構成(NAS内蔵のリバースプロキシ等)では、`PUBLIC_BASE_URL`を設定しないとリダイレクトURIが`http://`で組まれてGoogleログインが失敗する。**外向きのURLを組む処理を増やすときは`request.url`を直接使わず、必ずこのモジュール経由にすること**。

**セッションの取り消しは`users.sessions_valid_after`で行う。** Cookieはサーバーに状態を持たないので、ログアウトはこの端末のCookieを消すだけになる。アカウント画面の「すべての端末からログアウト」(`POST /api/auth/logout-all`)がこの列に現在時刻を入れ、`getCurrentUserId`はそれより前に発行された(`iat`がそれより前の)Cookieを受け付けない。`proxy.ts`は署名しか見ないので、取り消されたCookieでもページは開くが、APIが401を返してログイン画面へ戻る。

**新規アカウントの作り方は既定では2つだけ** —— 初回セットアップ(ユーザーが0人のとき`/api/auth/setup`かGoogleログインで作る最初の1人。自動的にadmin)と、管理者による`/[type]/admin`のユーザー管理からの作成。`GOOGLE_AUTO_SIGNUP=true`を設定した環境でだけ、Googleでログインした人を一般ユーザー(`role='user'`)として自動登録する(`lib/auth/google.ts`の`isGoogleAutoSignupEnabled`)。**有効にするとURLを知っていてGoogleアカウントを持つ人は誰でも入れる**ので、既定はオフのまま。初回adminの作成だけは`insert ... where not exists (select 1 from users)`で1文に閉じてあり、同時に2人がログインしても片方しかadminにならない。

**アカウント削除(`DELETE /api/account`)は本人が自分のアカウントを消す口**。消えるのはアカウント行と、FKの`on delete cascade`で連れて消える訪問記録・訪問予定・訪問予定リスト・口コミ・非表示設定・エクスポートジョブ、行が消える前に集めた写真ファイル(追記の写真も)/ZIPの実体(`exports/<ユーザーID>/`ごと)、そして**自分の非公開スポット**(本人にしか見えない=個人のデータのため)。**管理者による削除(`/api/admin/users/[id]`)も同じ範囲を消す** —— 処理は`lib/deleteUserAccount.ts`の1か所で、かつて管理者側は`users`の行を消すだけで写真・ZIP・非公開スポットが残っていた。最後の管理者かどうかは削除と同じトランザクションで管理者の行をロックしてから数える(先に数えると、同時に互いを消したときに0人になる)。**訪問記録が消える経路で写真のパスを集めるときは`lib/visitPhotoPaths.ts`の`collectVisitPhotoPaths`を通す** —— 追記(`visit_notes`)はカスケードで行だけ消えるので、`visits.photos`だけを集めると追記の写真が残る。**公開・承認待ち・却下のスポットとルートは残る**(`created_by`が`on delete set null`。他のユーザーの地図から突然スポットが消えないようにするため)。**最後の管理者は自分のアカウントを削除できない**(管理者による他人の削除と同じガード)。画面はアカウントタブの赤い節で、取り消せない操作なので**自分のメールアドレスを打ち直させてから**実行する。

### PWA(インストール可能化)

manifest(`app/manifest.ts`、Next.jsのMetadata Files規約で`/manifest.webmanifest`として配信)+アイコン(`public/icons/`のmanifest用3枚と、`app/icon.png`・`app/apple-icon.png`のファビコン/apple-touch-icon)による最小構成のPWA対応で、Service Worker・オフライン対応は意図的に持たない(「デプロイしたのに古い画面が出る」系の問題を避けるため、必要になるまで導入しない方針)。インストール後も中身は同じWebアプリで、認証Cookieもそのまま使われる。iOSはmanifestの`display`/`icons`を見ないため、`app/layout.tsx`の`metadata.appleWebApp`と`app/apple-icon.png`で別途同等の設定をしている。ページ自体のズームは`app/layout.tsx`の`viewport`(`maximumScale: 1`+`userScalable: false`)で無効化してある — 検索窓等への入力フォーカス時の自動ズームで下のタブバーが隠れ、地図表示中はピンチが地図操作に取られてページのズームを戻せなくなるため(地図の拡大縮小はMapLibreのジェスチャなので影響しない)。`/manifest.webmanifest`は`proxy.ts`のガード対象から除外が必要(上記「認証」参照)。アイコンPNGは`scripts/generate-icons.mjs`(sharp使用、依存には含めない)で生成したものをコミットしてあり、デザイン変更時のみ再生成する。なお、iOSのスタンドアロン起動では`target="_blank"`の外部リンクがアプリ内ブラウザ(オーバーレイ)で開かれる。かつて記事の概要を出すモーダルでだけ`x-safari-https://`スキーム(未文書化だがiOSが解釈する)で本物のSafariへ切り替えていたが、そのモーダルごと廃したので今はどこでも使っていない。

### MapLibreのワーカースクリプト(`public/maplibre-gl/`)

地図を作るコンポーネント(`MapView`・`MiniMap`・`SpotRepositionModal`)は`maplibre-gl`を直接importせず、必ず`lib/maplibre.ts`(`export *`での再エクスポート+CSSのimport+ワーカーURLの設定)を経由する。

maplibre-gl 6は、ワーカーURLを指定しない場合`import.meta.url`を起点に`./maplibre-gl-worker.mjs`を解決する実装になった(`src/util/web_worker.ts`の`defaultWorkerUrl`)。ところがwebpackはバンドル時に`import.meta.url`を`"file:///app/node_modules/maplibre-gl/dist/maplibre-gl.mjs"`という文字列へ置き換えるため、`http(s)`で始まらないURLとして弾かれて空文字が返り、`new Worker("", { type: "module" })`=**ページ自身のHTMLをJSモジュールとして読み込む**動作になる。ブラウザは`Failed to load module script: ... non-JavaScript MIME type of "text/html"`で拒否し、ワーカーが起動しないため**タイルもスポットのピンも一切描画されない**(maplibre-gl 5→6の更新で実際に起きた。maplibre-gl 6.0.0時点で上流に修正は無い)。

対策として`scripts/copy-maplibre-worker.mjs`(`predev`/`prebuild`で自動実行)が`maplibre-gl-worker.mjs`と、それが相対importする`maplibre-gl-shared.mjs`を`public/maplibre-gl/`へコピーし、`lib/maplibre.ts`が`setWorkerUrl('/maplibre-gl/maplibre-gl-worker.mjs')`で明示的に渡す。付随して次の2点が要る:

- `proxy.ts`のmatcherが`.mjs`を除外している(認証ガードの`/login`リダイレクトが返るとHTMLをJSモジュールとして読むことになり、同じ症状になるため)
- `Dockerfile`のprodステージが`public`をコピーしている(`output: standalone`は`.next/static`も`public`もコピーしないため。PWAのアイコン`public/icons/`が本番で404していたのも同じ原因)

バージョン固定でコミットせず毎回`node_modules`からコピーするため、maplibre-glを上げても中身がずれない。Turbopackへ移行する場合は、`import.meta.url`の扱いが変わってこの回避が不要になる可能性があるため再確認すること。

### ビルド番号

GitHub Actions(`.github/workflows/docker-publish.yml`)がビルド時に`<JST日時>-<短縮コミットハッシュ>`形式のビルド番号を生成し、`--build-arg BUILD_NUMBER`でDockerfileのprodステージに渡して`ENV BUILD_NUMBER`として焼き込む。`app/[type]/admin/page.tsx`(サーバーコンポーネント)が`process.env.BUILD_NUMBER`を読んで`AdminView`の`buildNumber` propに渡し、管理画面の見出し横に表示する(未設定時は「開発ビルド」)。`NEXT_PUBLIC_`で`next build`時に埋め込むのではなくリクエスト時に環境変数を読む方式にしてあるため、ビルド番号が毎回変わってもNext.jsのビルドキャッシュには影響しない(prodステージは`next build`の後段のため、Dockerレイヤキャッシュも実質壊さない)。

## 設計メモ(`docs/design/`)

機能ごとの設計の理由と、実装で踏みやすい点は機能別のファイルに分けてある。
**その機能に触る前に、該当するファイルを読むこと**(「なぜこうしないか」が書いてあり、
読まずに直すと過去に直した不具合を戻すことになる)。実装を変えたら同じコミットで直す。

| ファイル | 中身 |
|---|---|
| [docs/design/spot-types.md](docs/design/spot-types.md) | スポット種別(`spot_types`)と種別ごとの設定、ランク・シリーズ・カテゴリ、ピンの見た目を決める仕組み。 |
| [docs/design/map.md](docs/design/map.md) | 経路と訪問順・訪問予定リストの線、Google マップ・生成AIへの導線、ピンと線の出し分け、重なったピン、別種別の重ね表示、共通の UI 部品。 |
| [docs/design/admin.md](docs/design/admin.md) | キー一覧での削除、GitHub・ZIP からの取り込み、修正・追加の依頼、還元用エクスポート、全削除、スポットの新規登録と CSV の差分更新。 |
| [docs/design/visits.md](docs/design/visits.md) | 訪問記録と口コミ、写真と追記、エクスポート、未訪問記録と非表示、訪問予定リスト(旅程)と天気。 |

## 外部データソース(Wikipedia、OSM Overpass/Nominatim、政府オープンデータ等)を扱う際の注意

このリポジトリのスポットデータは、OSM Overpass・Wikipedia API・Nominatimからの取得によって構築・拡張されてきた。この種のデータ収集作業を行う際は、

- 自分でレート制限をかけ、リクエストには識別可能な`User-Agent`(プロジェクト名かリポジトリのURL。個人の連絡先は載せない)を設定すること — Overpass API・Nominatimはこのプロジェクト専有のインフラではなく、無料でコミュニティ運営されているフェアユース前提のサービス
- レンダリング済みHTMLのスクレイピングより、公式API(MediaWiki REST/Action API、Overpass QL)を優先すること
- **実行時に叩く外部API(地名検索・逆ジオのNominatim、天気予報のOpen-Meteo)も同じ扱い。** ブラウザから直接ではなくRoute Handler(`/api/geocode`・`/api/geocode/reverse`・`/api/weather`)を通し、識別できる`User-Agent`を付け、**自分でキャッシュと間隔制限をかける**(画面を開くたびに素通しで叩かない)。出典表示の要るデータ(Open-MeteoはCC BY 4.0)は、押す前に読める場所に出典を書く
- 政府や第三者のオープンデータには、このアプリのライセンスと整合しない利用制限(非商用限定など)が付いていることが多い。そうしたデータセットの中身(名称・座標・説明文)をそのまま`db/init/`に転記しないこと。せいぜい「抜けているスポットに気づくためのヒント」として使い、実際のデータ(座標・説明文)はライセンス面で問題のない別ソースから取り直すこと
- 一括でスポットを追加した後は、コミット前に既存行との重複(名前一致・近接座標)がないか確認すること — 既存の`tourist`のシードデータにも、過去のインポートで名前だけの突き合わせをすり抜けた重複に近いものが存在する
- 容量の大きいシードデータ(数千〜数万件規模)は、travel-logリポジトリ本体の`db/init/`に直接コミットせず、外部リポジトリ[travel-log-data](../travel-log-data)側に`<スポットキー>/`フォルダ単位のCSVとして置き、`/[type]/admin`の既存CSVインポート機能で取り込む(詳細はtravel-log-data/README.md参照)。`tourist`(観光地)もこの方式で、`spot_types`の行自体はアプリ初期化時に自動で作られるが、スポットデータは他の種別と同様に手動CSVインポートが必要
  - 本体に置かないのはライセンスのため —— 説明文はWikipediaの引用(CC BY-SA)、座標の一部はOSM(ODbL)由来で、MITのアプリ本体とは条件が合わない

## コミット前に

このアプリは実際のユーザーデータ(`users.email`、`visits.memo`、`visits.photos`が指す写真ファイル、`reviews.body`)を保持する。コミット前には、差分にプレースホルダーではない実際の個人情報(実メールアドレス・実名・写真・DBダンプ/エクスポート等)が紛れ込んでいないか確認すること — ローカルのDocker DBに実際のテストアカウントを入れたまま作業していると、気づかず混入しやすい。

コードに変更を加えたら、その変更でREADME.md・CLAUDE.md・docs/(とくに`docs/design/`の該当ファイル)の記述(画面のパス、ロール、データ件数、機能の説明など)が古くならないか確認し、必要なら同じコミットで更新すること。特にルーティング構造・ロールの種別と権限・スポット種別ごとのデータ件数・`db/init/01_schema.sql`のスキーマは変更が入りやすく、記述が古いまま放置されがち。
