# Vercel + Supabase で動かす

自前のサーバーを持たずに公開するための手順。アプリを Vercel(Hobby)、DB と写真を
Supabase(Free)に置く。**どちらも無料プランで足りる規模を前提にしている**。

Docker で動かす場合はこの文書は不要 —— [README](../README.md) の「本番運用」を参照。

## この構成で失われるもの・注意点

| 項目 | 内容 |
|---|---|
| **訪問記録のエクスポート(ZIP)** | **使えない**。生成がレスポンス後も走り続けるバックグラウンド処理で、成果物もローカルFSに置くため、サーバーレスでは成立しない。`NEXT_PUBLIC_EXPORTS_ENABLED=false` で管理画面のパネルごと畳む(`lib/features.ts`) |
| **Supabase の一時停止** | 無料プロジェクトは**7日間アクセスが無いと停止**し、手動で再開するまで DB に繋がらない。日常的に開くなら問題にならないが、放置すると止まる |
| **容量** | 無料枠は DB 500MB・ストレージ 1GB。スポットは全種別で約9万件(≒数十MB)なので DB は収まる。写真は1枚あたり数百KBなので、1GB でおよそ数千枚。**写真ごと畳むこともできる**(`NEXT_PUBLIC_PHOTOS_ENABLED=false`) |
| **1リクエストの上限** | リクエスト・レスポンスとも **4.5MB**。公開スポットのダウンロードは常に2000件ずつに分けて取るので設定は不要。写真は `NEXT_PUBLIC_MAX_UPLOAD_BYTES` で上限に合わせて書き出す |
| **商用利用** | Vercel Hobby は非商用限定。収益を生む用途なら Pro が要る |

## 1. Supabase を用意する

1. [supabase.com](https://supabase.com) でプロジェクトを作る(リージョンは Tokyo が近い)。
   このとき決める **Database Password** は後で使うので控える
2. **Storage** で写真用のバケットを作る。名前は任意(既定は `visit-photos`)。
   **Public は off(非公開)にする** —— アプリは公開URLを使わず、必ず認証付きの
   配信ルート(`/api/photos/...`)からサーバー側のキーで読み出す
3. **Project Settings → API Keys** から **Secret key**(`sb_secret_...`)を控える。
   **サーバー専用**なので `NEXT_PUBLIC_` を付けて渡さないこと。

   旧世代の `anon` / `service_role`(JWT)は **Legacy API Keys** タブにあり、
   2026年末に廃止予定。**新規プロジェクトでは発行されない**ので、
   `service_role` が見当たらなくても正しい —— Secret key を使う
4. **Project URL**(`https://<project-ref>.supabase.co`)を控える。

   **ダッシュボードの置き場は動くので、`project-ref` から組み立てるのが確実。**
   `project-ref` はダッシュボードのURL `.../dashboard/project/●●●●` の `●●●●` で、
   下の接続文字列のユーザー名 `postgres.●●●●` の後ろと同じ文字列。
   画面で探すなら **Integrations → Data API**(Settings → API ではない)。

   なお**このアプリが叩くのは Storage の `/storage/v1/object/...` だけ**で、
   Data API(`/rest/v1/`)は使わない。プロジェクト作成時に Data API を無効にしていても
   URLは同じで問題なく動く(有効化は不要)
5. **Connect** から接続文字列を2種類控える
   - **Transaction pooler**(ポート `6543`)… アプリが使う。サーバーレス向け
   - **Session pooler**(ポート `5432`)… マイグレーションで使う

## 2. スキーマを流す

**方法は2つある。手元に接続情報を置きたくないなら A、Docker があるなら B。**

### A. Supabase の SQL Editor に貼る(接続情報を手元に置かない)

ブラウザで完結する。ログイン済みのダッシュボードから実行するので、
**DBのパスワードもキーもこの機械に置かずに済む**。

```bash
sh scripts/bootstrap-sql.sh > /tmp/bootstrap.sql
```

出てきたSQLを **Supabase → SQL Editor** に貼って実行する。生成されるSQLに接続情報は
含まれない(スキーマ本体と全マイグレーション、そして `schema_migrations` への記録だけ)。

**`schema_migrations` への記録まで入っている**ので、あとから B を使っても
「適用済み」と正しく判定される。この一致は `scripts/bootstrap-sql_test.sh` が
検証している(列・索引・トリガー・適用記録をアプリの起動時の適用の結果と突き合わせる)。

**空のDBに1回だけ**使うこと。途中から差分だけを当てる用途は想定していない。

### B. アプリと同じイメージで適用スクリプトを走らせる

```bash
cp .env.remote.example .env.remote   # 値を入れる(Session pooler の情報)
sh scripts/migrate-remote.sh
```

`migrate: migrations done (applied=13, skipped=0)` のように出れば完了。
**接続情報を書いた `.env.remote` がこの機械に残る**点に注意(gitignore 済みだが、
共用の機械や、他人が触る環境では A のほうがよい)。

**マイグレーションだけは 5432(Session pooler)を使う** —— advisory lock を張ったまま
複数文のDDLを流すので、Transaction pooler では通らない。

### スキーマを変えたとき

**Vercel へデプロイする前にもう一度流すこと**(Docker運用と違い、起動時の自動適用が走らない)。
B ならそのまま再実行すればよい。A は初回投入用なので、差分を当てるなら B を使うか、
追加したマイグレーションのSQLと `schema_migrations` への insert を手で貼る。

## 3. Vercel にデプロイする

1. [vercel.com](https://vercel.com) で GitHub の travel-log リポジトリを Import する
   (リポジトリ直下が Next.js アプリなので Root Directory は既定のままでよい)
2. 環境変数を設定する(下表)。**Production / Preview / Development すべてに入れる** ——
   `NEXT_PUBLIC_` の値はビルド時に埋め込まれるため、後から足しても再デプロイするまで効かない
3. Deploy する。発行された `https://<プロジェクト名>.vercel.app` を控え、
   `PUBLIC_BASE_URL` にその URL を設定して**もう一度デプロイする**
   (Cookie の `Secure` 属性と、Google ログインのリダイレクト URI に使う)
4. 開くと `/login` に飛ぶ。アカウントが無いので初回アカウントを作る(自動的に管理者になる)
5. スポットデータは `/[type]/admin` の「GitHubリポジトリからスポット種別取り込み」で入れる

### 環境変数

| 変数 | 値 | 意味 |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres.<ref>:<パスワード>@<host>:6543/postgres?sslmode=require` | **Transaction pooler(6543)**。サーバーレスは同時に何本も立ち上がるのでプーラー経由にする |
| `PG_POOL_MAX` | `3` | 1インスタンスが張る接続数の上限。既定(10)のままだとプーラーの枠を食い潰す |
| `SESSION_SECRET` | `openssl rand -base64 32` の出力 | セッションCookieの署名鍵 |
| `PUBLIC_BASE_URL` | `https://<プロジェクト名>.vercel.app` | 外向きURL。初回デプロイでURLが決まってから設定する |
| `PHOTO_STORAGE` | `supabase` | 写真の保存先。永続ディスクが無いのでローカルFSは使えない |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co`(`project-ref` は `DATABASE_URL` のユーザー名 `postgres.` の後ろと同じ) | |
| `SUPABASE_SECRET_KEY` | `sb_secret_...` | **サーバー専用**。`NEXT_PUBLIC_` を付けない(レガシーの `service_role` しか無い既存プロジェクトは `SUPABASE_SERVICE_ROLE_KEY` でも可) |
| `SUPABASE_STORAGE_BUCKET` | `visit-photos` | 1で作ったバケット名 |
| `NEXT_PUBLIC_EXPORTS_ENABLED` | `false` | 訪問記録エクスポートを畳む(サーバーレスでは成立しないため) |
| `NEXT_PUBLIC_MAX_UPLOAD_BYTES` | `4500000` | 写真を含む POST の本文上限。この範囲に収まる画質で書き出す |
| `NEXT_PUBLIC_PHOTOS_ENABLED` | (任意)`false` | 写真の添付ごと畳む。ストレージ 1GB を使い切りたくない場合に |
| `GOOGLE_AUTO_SIGNUP` | (任意)`true` | Google でログインした人を一般ユーザーとして自動登録する。**下記の注意を読むこと** |

`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` は Google ログインを使うときだけ。
Google Cloud Console の「承認済みのリダイレクト URI」に
`https://<プロジェクト名>.vercel.app/api/auth/google/callback` を追加する。

### 誰でも登録できるようにする場合(`GOOGLE_AUTO_SIGNUP=true`)

**URL を知っていて Google アカウントを持つ人は誰でも入れる状態になる。**
無料枠(DB 500MB・ストレージ 1GB・帯域)は第三者の利用ぶんも同じ枠から出ていくので、
少なくとも次は決めてから有効にすること。

- 想定より増えたときにどうするか(`GOOGLE_AUTO_SIGNUP` を外せば新規登録だけ止まる。
  既存アカウントはそのまま使える)
- 写真を許すか(`NEXT_PUBLIC_PHOTOS_ENABLED=false` ならストレージはほぼ増えない)
- 利用者は自分でアカウント画面から**アカウント削除**できる(訪問記録・写真・口コミ・非公開スポットが
  消え、登録した公開スポットは登録者だけ外して残る)

## 写真サイズの決め方

**`NEXT_PUBLIC_MAX_UPLOAD_BYTES`** の1枚あたりの目安は「この値 × 0.9 ÷ 10枚」で約400KB。
長辺1280pxのJPEGは通常これに収まり、収まらないものだけ画質を落として書き出す
(`lib/visitPhoto.ts`)。**未設定なら従来どおり画質0.8で1回書き出す**ので、
Docker 運用側には影響しない。

## つまずいたら

- **`self-signed certificate in certificate chain` / `unable to verify the first certificate`**
  … `pg` は接続文字列の `sslmode=require` を「公開CAで検証する」と解釈する。
  プーラーの証明書が検証できない場合は `sslmode=no-verify` に変えると通る
  (暗号化はされるが証明書の検証はしない)。厳密にやるなら Supabase の CA 証明書を
  取得して `sslrootcert` を指す
- **`Max client connections reached`** … `PG_POOL_MAX` を下げる。それでも出るなら
  接続先が Session pooler(5432)になっていないか確認する(アプリは 6543)
- **公開スポットのダウンロードが途中で失敗する** … 1チャンクが 4.5MB を超えている
  可能性がある。`lib/useSpotCache.ts` の `SPOT_DOWNLOAD_CHUNK` を下げる
- **写真の保存で 413** … `NEXT_PUBLIC_MAX_UPLOAD_BYTES` が未設定か大きすぎる
- **突然 DB に繋がらなくなった** … Supabase の無料プロジェクトが7日間の無アクセスで
  停止している。ダッシュボードから再開する
- **写真の保存で `Invalid JWT`** … 新しい Secret key を `Authorization: Bearer` に
  載せると出る(JWTではないため)。`lib/photoStorage.ts` はキーの接頭辞
  (`sb_`)を見て `apikey` ヘッダだけに載せ分けているので、環境変数の入れ間違い
  (Secret key を `SUPABASE_SERVICE_ROLE_KEY` ではなく別の変数に入れた等)を疑う
