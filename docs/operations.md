# 運用ガイド

Docker で本番運用するときの詳細と、任意の設定(Google ログイン・リバースプロキシ)。
起動手順の要点は [README](../README.md) の「本番運用」にある。

## 本番運用の詳細

`main`へのpushでGitHub Actions(`.github/workflows/docker-publish.yml`)が本番用イメージを
ビルドして`ghcr.io/rtcode337/travel-log:latest`(+コミットSHAタグ)へ公開する。
本番ホストでは本リポジトリのクローン(`docker-compose.yml`を使う)を置き、
イメージはビルドせずpullして使う。

- Composeのプロジェクト名は本番・開発・standaloneとも`travel-log`
- 公開されるイメージは`ghcr.io/rtcode337/travel-log`の1つ。スキーマとマイグレーションSQLも
  これに焼き込まれ、アプリが起動時に当てる
- **データの置き場は`data/`の1つだけ**(リポジトリ直下)。この下に`db/`(Postgresの実データ)・
  `photos/`(添付写真)・`exports/`(エクスポートのZIP)を`init`サービスが起動時に作る。
  **バックアップは`data/`をコピーすればよい**(停止してからコピーすること)。
  standaloneでもホストに用意するのは親ディレクトリ1つで、YAML冒頭の`x-data-dir`に書く
- **`app`は非rootで動く**。既定は`10001:10001`で、**ホストに実在しない番号**にしてある
  (万一コンテナから抜け出されても、ホストのユーザーのファイルには届かない)。
  そのぶん`data/`はホストから見て「知らないユーザー」の持ち物になるので、
  **バックアップから書き戻すときやホストで直接編集したいときは**`.env`に
  `TRAVEL_LOG_UID`/`TRAVEL_LOG_GID`で`id -u`/`id -g`を設定する
  (standaloneはYAML冒頭の`x-run-as`)。所有者合わせは起動前に`init`が
  自動でやるので、`chown`を手で打つ必要はない
- **PostgreSQL 16 時代のデータを持つ既存環境は、更新前に1回だけデータ移行が必要**
  ([postgres-18-upgrade.md](postgres-18-upgrade.md))。移行せずに起動すると
  dbコンテナが起動に失敗する(データは壊れない)
- **v1.0.0 より前から動かしているホストは、先に v1.0.0 のイメージで一度起動すること。**
  v1.0.0 より後の版は過去の移行SQLを持たないので、それより前の形のDBでは起動時に
  `migrate: failed: このDBは v1.0.0 より前の形です…`で止まる(データは壊れない)。
  `docker-compose.yml`のイメージを一時的に`ghcr.io/rtcode337/travel-log:sha-1eec4ae`
  (v1.0.0)にして`up -d`し、`docker compose logs app`で`migrate: migrations done`を
  確かめてから`latest`に戻す
- **DBスキーマの更新は自動**。`docker compose up`すると`app`が待ち受けを始める前に未適用の
  マイグレーションを順に当てる(失敗した場合は待ち受けに進まないので、古いスキーマのまま
  動くことはない)。適用状況は
  `docker compose exec db psql -U travel_log -d travel_log -c "select * from schema_migrations"`、
  ログは`docker compose logs app`で確認できる(`migrate:`で始まる行)
- GitHub Actions(`GITHUB_TOKEN`)から公開したパッケージはリポジトリに自動リンクされ、
  可視性もリポジトリと同じ(=public)になるため、追加設定なしで匿名pullできる。
  リポジトリをprivateにした場合は本番ホストで`docker login ghcr.io`
  (`read:packages`権限のPAT)が必要になる
- イメージは`linux/amd64`と`linux/arm64`のマルチアーキで公開しており、pull時に
  ホストに合う方が自動選択される
- 特定時点に戻したいときは`docker-compose.yml`のイメージタグを`latest`から
  `sha-xxxxxxx`(Actionsが付けるコミットSHAタグ)に一時的に変えてpullし直す
  (マイグレーションは前進のみで、巻き戻しスクリプトは持たない。スキーマ変更を伴う
  リリースを戻す場合はDBのバックアップからのリストアが必要)
- Actionsはビルド番号(`20260722-1035-9162ba9`のようなJST日時+短縮コミットハッシュ)を
  イメージに埋め込み、管理画面`/[種別キー]/admin`の見出し横に表示する。今動いている
  イメージがいつのどのコミットのものか、pull後の反映確認に使える(ローカル開発時など
  埋め込みが無い場合は「開発ビルド」と表示される)

## バックアップと復元

データはすべて `data/`(standalone では `x-data-dir`)の下にある —— Postgres の実データ(`db/`)・
添付写真(`photos/`)・エクスポートの ZIP(`exports/`)。

- **バックアップ**: `docker compose down` で止めてから `data/` をまるごとコピーする。
  動いている Postgres の実データをそのままコピーしても、整合した状態は保証されない
- **復元**: `docker compose down` のあと `data/` をバックアップで置き換えて `docker compose up -d`。
  `app` は非 root で動くので、所有者は起動時に `init` が揃える(手で `chown` しなくてよい)
- `PHOTO_STORAGE=supabase` で写真を外に置いている場合、写真は `data/` に入らない。
  そちらは Supabase 側でバックアップする

## リポジトリを置けない環境(NASのコンテナマネージャー等)

`.env`もクローンも置けず、管理画面にYAMLを貼り付けて起動するタイプの環境向けに
[docker-compose.standalone.example.yml](../docker-compose.standalone.example.yml)を用意している。
`${...}`を使わず値を直書きし、bindマウントを絶対パスで書いたもの(サービス構成・
起動順は`docker-compose.yml`と同じ)。`docker-compose.standalone.yml`としてコピーし
(コピー側は`.gitignore`済み。秘密を直書きするため雛形は直接編集しない)、冒頭の
「ここだけ編集」——データの置き場(`x-data-dir`)の絶対パスと
`SESSION_SECRET`——を書き換えて貼り付ければ起動する。

`SESSION_SECRET`は空のままだとログイン時に`SESSION_SECRET is not set`で失敗するので、
必ず32バイト程度のランダム文字列を入れること。

## Docker を使わない場合

ローカルに Postgres を別途用意し、`.env.example` を `.env.local` としてコピーして
`DATABASE_URL` / `SESSION_SECRET` を設定した上で `npm install && npm run dev` でも
起動できる。その場合は `db/init/01_schema.sql` と `db/migrations/*.sql` を手動で実行する。

## Googleログインの設定(任意)

メールログインに加えて、Googleアカウントでのログインも利用できる(設定しない場合は
メールログインのみ)。

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials) で
   OAuthクライアントID(種類: ウェブアプリケーション)を作成する
2. 「承認済みのリダイレクトURI」に `http://localhost:7040/api/auth/google/callback`
   を追加する(本番環境ではそのドメインのURLも追加する)
3. 発行された クライアントID / クライアントシークレット を設定する
   - Docker Compose の場合: リポジトリ直下に `.env` ファイルを作成し、
     `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` を書く(Next.js が読む
     `.env.local` とは別物なので注意)
   - Docker を使わない場合: `.env.local` に同じ2つの値を追加する

既存のメールアカウントと同じメールアドレスでGoogleログインした場合は自動的に紐付く。
既定では自由なサインアップはできず、管理者が作成したアカウントのみログインできる
(`GOOGLE_AUTO_SIGNUP=true`を設定した環境では、Googleでログインした人が一般ユーザーとして
自動登録される。**設定すると、URLを知っていてGoogleアカウントを持つ人は誰でも入れる**)。

**リバースプロキシ(HTTPS終端)の背後で動かす場合**、アプリが受け取るリクエストは
プロキシからのプレーンHTTPになる。リダイレクトURIのスキームは`X-Forwarded-Proto` /
`X-Forwarded-Host`から判断しているため、これらを送らないプロキシ(NAS内蔵の
リバースプロキシ機能など、設定項目が無いものもある)ではリダイレクトURIが
`http://`で組まれ、Googleコンソールに登録した`https://`のURIと一致せず認証に失敗する。
その場合は`PUBLIC_BASE_URL`に公開URLを設定する(設定するとヘッダより優先される)。

```
PUBLIC_BASE_URL=https://travel.example.com
```

- `.env`(Docker Compose)/ `.env.local`(Dockerを使わない場合)/
  standalone用のコピー(`docker-compose.standalone.yml`)冒頭の`x-public-base-url` のいずれかに書く
- パス部分は使わず、スキーム・ホスト・ポートだけを見る
- `https://`を設定するとセッションCookieに`Secure`属性が付く。同じインスタンスに
  LAN内から`http://<ホスト>:7040`で直接アクセスしてもログインできなくなる点に注意
  (公開URL経由でアクセスすること)
- 直接`http://<ホスト>:7040`で使う場合や、`X-Forwarded-*`を送るプロキシ(nginx等で
  設定済み)の場合は設定不要
