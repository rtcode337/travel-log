# PostgreSQL 16 → 18 への移行手順(既存環境向け・1回だけ)

2026-08 に db サービスのイメージを `postgres:16-alpine` から `postgres:18-alpine` に
上げた。**PostgreSQL はメジャーバージョン間でデータディレクトリの形式に互換性が無い**ため、
16 で作った DB データを持つ既存環境は、イメージを上げる前にこの手順で
dump → restore の移行を行う。新規に立てる環境ではこの手順は不要(そのまま起動すればよい)。

移行を行わずに新しいイメージで起動すると、db コンテナが
「database files are incompatible with server」で起動に失敗する(データが壊れることはない)。

手順は「`docker compose` コマンドが使えるか」で分かれる。どの YAML
(`docker-compose.yml` / standalone用のコピー)で動かしているかは関係ない
—— NAS のコンテナマネージャーのように管理画面でスタックを運用している環境は、
`docker-compose.yml` を使っていても SSH からは `docker compose` を叩けないので後者の手順になる。

**データの置き場所は `data/`**(リポジトリ直下)。かつては `db/data/` だったので、
それ以前から動かしているホストでは、更新時に `mv db/data data` で移してから起動する
(移さずに起動すると空のクラスタが作られ、初期状態のアプリが立ち上がる)。

## `docker compose` コマンドが使えるホスト

```bash
# 1. 旧スタック(16)が動いている状態でバックアップを取る
docker compose exec -T db pg_dump -U travel_log --clean --if-exists travel_log > backup-pg16.sql

# 2. 止めて、旧データを退避する(消さずに残しておく)
docker compose down
mv data data.pg16

# 3. 新しい定義とイメージに更新して DB だけ起動する
#    (data は Docker が作り直し、18 の空クラスタが data/18/docker に初期化される)
git pull
docker compose pull
docker compose up -d db

# 4. ダンプを流し込む(db が healthy になるのを待ってから)
docker compose exec -T db psql -U travel_log -d travel_log -v ON_ERROR_STOP=1 < backup-pg16.sql

# 5. 残りを起動する(init サービスは適用済み記録を見て何もせず終了する)
docker compose up -d
```

## 管理画面でスタックを運用しているホスト(`docker compose` コマンドが無い環境)

スタックの停止・起動・定義の更新は管理画面で行い、dump / restore は SSH から
素の `docker` コマンドで行う。コンテナ名は環境によって違うので、最初に `docker ps` で
db と app の実際の名前を確認しておく。

```bash
# 0. コンテナ名を確認する(以下 <db> <app> と書く。travel-log-db-1 のような名前)
docker ps --format '{{.Names}}\t{{.Image}}'

# 1. 旧スタック(16)が動いている状態でバックアップを取る
docker exec -i <db> pg_dump -U travel_log --clean --if-exists travel_log > backup-pg16.sql

# 2. 管理画面でスタックを停止してから、旧データを退避する(消さずに残しておく)。
#    対象は docker-compose.yml ならクローン直下の data、standalone なら
#    YAML 冒頭の x-db-data-dir のパス。postgres ユーザー(uid 70)所有なので
#    root 権限が要る。退避したら空のディレクトリを作り直しておく
#    (bindマウント先を自動作成しない環境があるため)
sudo mv <データディレクトリ> <同じパス>.pg16
sudo mkdir <データディレクトリ>

# 3. 定義とイメージを更新して、管理画面でスタックを起動する
#    - リポジトリのクローン運用: git pull しておく
#    - YAML 貼り付け運用: 新しい docker-compose.standalone.example.yml を基に
#      自分の値を入れ直した内容に貼り替える
#    そのうえで「イメージを最新にして再作成」相当の操作で起動する。
#    18 の空クラスタが初期化され、スキーマも自動適用されてアプリまで起動する

# 4. ダンプを流し込む。--clean 付きなので、手順3で作られた空のテーブルは
#    いったん落とされてダンプの内容で作り直される
docker exec -i <db> psql -U travel_log -d travel_log -v ON_ERROR_STOP=1 < backup-pg16.sql

# 5. アプリを再起動する(管理画面からでもよい)
docker restart <app>
```

どちらの場合も、動作を確認したら退避した旧データと `backup-pg16.sql` を消してよい
(どちらも訪問記録・アカウント情報を含むので、残す場合も扱いに注意)。

## 補足

- 16 と 18 でホスト側のデータの置き場が変わっている(データディレクトリ直下または
  `pgdata/` → `18/docker/`)。これは postgres 公式イメージが 18 で PGDATA の既定と
  `VOLUME` 宣言を変えたことに合わせたもので、詳細は `docker-compose.yml` の
  db サービスのコメント参照
- 今後のメジャーアップデート(→19 以降)も同じ手順で移行できる。Dependabot は
  postgres のメジャーを意図的に無視する設定にしてある(`.github/dependabot.yml`)
