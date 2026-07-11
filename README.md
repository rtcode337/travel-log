# Travel Log — 観光地訪問記録アプリ

観光地への「訪問記録」を主役にしたアプリ(仕様書 v0.1 のフェーズ1 MVP)。

- 観光地に**必訪ランク(S/A/B)**をキュレーション項目として付与(口コミ評価とは別軸)
- 訪問記録(いつ・何回・メモ)をファーストクラスの機能に
- 同一スポットへの複数回訪問に対応

## 技術スタック

| 領域 | 採用技術 |
|---|---|
| フロントエンド | Next.js (App Router) + TypeScript |
| UI | Tailwind CSS |
| 地図 | MapLibre GL JS(OpenStreetMap タイル) |
| バックエンド | Supabase(Auth + PostgreSQL) |

## 画面

| パス | 内容 |
|---|---|
| `/map` | 地図(ホーム)。ランク別ピン(S=大きい金 / A=銀 / B=小さい灰)、訪問済みは✓バッジ。ランク・訪問状態・カテゴリでフィルタ。ピンタップでボトムシート→詳細へ |
| `/spots` | 都道府県→スポット一覧のドリルダウン。ランク順/名前順/訪問日順ソート |
| `/spots/[id]` | スポット詳細。ミニマップ、訪問履歴(複数回対応)、訪問記録モーダル(日付精度・メモ) |
| `/admin` | スポットの追加・編集・削除、CSVインポート |
| `/login` | メールログイン |

## セットアップ

### 1. Supabase プロジェクトの作成

1. [Supabase](https://supabase.com/dashboard) で新規プロジェクトを作成
2. SQL Editor で `supabase/migrations/0001_init.sql` を実行(テーブル + RLS)
3. 続けて `supabase/seed.sql` を実行(サンプルデータ51件)
4. Authentication → Users → **Add user** で自分のアカウント(メール+パスワード)を作成
   - フェーズ1はサインアップ非公開のため、ダッシュボードから直接作成する

### 2. アプリの起動

```bash
cp .env.example .env.local
# NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY を
# Supabase の Settings → API の値に書き換える

npm install
npm run dev
```

http://localhost:3000 を開き、作成したアカウントでログインする。

## CSVインポート形式

`/admin` からインポートできる。1行目はヘッダー行(列順は自由)。

```csv
name,name_kana,prefecture,municipality,lat,lng,rank,category,description,official_url
厳島神社,いつくしまじんじゃ,広島県,廿日市市,34.2959,132.3197,S,神社仏閣,海に浮かぶ大鳥居,https://example.com
```

- 必須列: `name`, `prefecture`, `lat`, `lng`, `rank`, `category`
- `rank`: `S` / `A` / `B`
- `category`: 神社仏閣 / 自然 / 城 / 温泉 / 街並み / 美術館博物館 / その他

## データ設計

`spots`(観光地マスタ)/ `visits`(訪問記録)/ `reviews`(口コミ・フェーズ3用スキーマのみ)を分離。
必訪ランクは spots 側のキュレーション項目で、reviews には一切依存しない。

RLS:

- `spots`: 全員読み取り可。書き込みは認証済みユーザー(フェーズ1は自分のみの前提。フェーズ3で管理者ロール判定に差し替え)
- `visits`: 本人のみ読み書き可
- `reviews`: public は全員読み取り可、書き込みは本人のみ

## 今後(仕様書のフェーズ2以降)

- ダッシュボード(都道府県塗り分け、制覇率)
- 写真アップロード(Supabase Storage。`visits.photos` カラムは定義済み)
- PWA化、オープンデータ一括インポート
- マルチユーザー対応・口コミ機能・スポット申請承認フロー
