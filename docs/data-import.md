# スポットデータの取り込み

スポットの初期データ(シード用CSV)は本リポジトリには同梱せず、別リポジトリ
[travel-log-data](https://github.com/rtcode337/travel-log-data)にスポット種別ごとの
CSVとして置き、`/[type]/admin`のCSVインポート機能で取り込む(`tourist`=観光地も含め全種別共通)。

```csv
name,name_kana,lat,lng,region,rank,series,categories,description,key
厳島神社,いつくしまじんじゃ,34.2960222,132.3198944,広島県,A,神社,,海に浮かぶ大鳥居,厳島神社
```

- 必須列: `name`, `lat`, `lng`, `region`。`rank`はA〜Eか空欄(ランクを使う種別のみ意味を持つ)。
  `series`/`categories`は自由入力。
  `categories`は1スポットに複数付けられ、パイプ区切りで書く(列ごと省略した場合は
  既存スポットのカテゴリを変更しない)。`key`は省略可の種別内一意な参照キー
  (経路のCSVがスポットを指すのに使う)
- 上記以外の列がヘッダーにあるとインポートを中止する。綴り違いや旧フォーマットの
  CSVが、値の欠けた状態で黙って取り込まれるのを防ぐため
- 差分更新(`key`一致を最優先、無ければ`name`+`lat`+`lng`の完全一致で同一判定)。
  一致した既存スポットは内容が違えばCSVの内容で上書きされるため、CSV側の修正も
  再アップロードだけで反映され、同じCSVを何度アップロードしても重複登録されない
- スポットを巡った順に矢印で繋ぐ経路は、別ファイル`routes.csv`(列:
  `route,series,seq,spot_key,description,leg_description`)を同じ管理画面から
  スポットCSVの後に取り込む(スキーマの詳細はtravel-log-data/README.md参照)
- **CSVから行を消してもDBからは消えない**(差分更新はCSVに無い行に触らないため)。
  削除は`/[type]/admin`の「キー一覧を指定して削除」(admin専用)に`key`を1行1つ
  貼り付けて行う。travel-log-data側の`exclude.txt`(削除したスポットのkeyを追記して
  いくファイル)をそのまま貼る想定で、該当が無いキーはエラーにせず読み飛ばす

観光地(`tourist`)データの`description`はWikipedia記事冒頭文の引用(CC BY-SA 4.0)、
`lat`/`lng`はWikipedia記事座標(CC BY-SA 4.0)またはWikidata `P625`(CC0)由来のため、
それぞれの出典表示はtravel-log-data側で行っている(本リポジトリのMITライセンスはアプリのコードにのみ適用)。
ランクの決め方などデータの詳細はtravel-log-data/README.mdを参照。
