/**
 * 地図データ(chiezoのOverture Places辞典)から周辺のスポット候補を引くための語彙と組み立て。
 * **サーバー専用ではない**(語彙表は画面のプレースホルダーにも使う)。
 *
 * OSM辞典(`lib/osmNearby.ts`)と**引き方は同じ**(全文検索 + 種別での絞り込みを混ぜる)。
 * 違うのは語彙と、取れるものの穴の位置:
 *
 * | | Overture | OSM |
 * |---|---|---|
 * | 日本の件数 | 301万 | 155万 |
 * | 店のURL | よく入っている | ほとんど無い |
 * | 電話番号 | 入っている | ほとんど無い |
 * | 都道府県 | **ほぼ空**(`extra.area`が入らない) | `extra.area`に名前が入る |
 * | 住所 | 自由記述(和英が混ざる) | `addr:*`タグで構造化 |
 *
 * **両方を引いて混ぜる**のはこの表のため。店の数とURLはOverture、都道府県と
 * 構造化された住所はOSMが埋める。片方だけにすると、どちらかが必ず落ちる。
 *
 * 種別の絞り込みは`filter?feature=category=<カテゴリ>`(chiezo側でOSMと同じ書き方に
 * 揃えてある)。カテゴリ名はOverture独自なので、語 → カテゴリの表を持つ。
 */

import { PREFECTURES } from "./types";

/**
 * 検索語 → Overtureのカテゴリ。**当てはまらない語は全文検索だけで探す**。
 *
 * カテゴリ名は実データから拾ったもの(件数は日本全体)。**推測で書かない** ——
 * 存在しないカテゴリを指定しても0件が返るだけで、エラーにならず気づけない。
 */
const CATEGORY_BY_WORD: { words: string[]; categories: string[] }[] = [
  {
    words: ["ランチ", "昼食", "ごはん", "ご飯", "食事", "飲食", "レストラン", "グルメ"],
    categories: [
      "restaurant",
      "japanese_restaurant",
      "cafe",
      "fast_food_restaurant",
      "diner",
    ],
  },
  { words: ["カフェ", "喫茶", "コーヒー", "珈琲"], categories: ["cafe", "coffee_shop", "tea_room"] },
  {
    words: ["居酒屋", "バー", "飲み屋", "パブ", "立ち飲み"],
    categories: ["bar", "pub", "sake_bar", "cocktail_bar", "wine_bar", "beer_bar"],
  },
  { words: ["ラーメン", "らーめん", "麺", "そば", "うどん"], categories: ["noodles_restaurant"] },
  { words: ["寿司", "すし", "鮨"], categories: ["sushi_restaurant"] },
  { words: ["焼肉", "焼き肉", "バーベキュー"], categories: ["barbecue_restaurant"] },
  { words: ["中華", "中国料理"], categories: ["chinese_restaurant"] },
  { words: ["イタリアン", "パスタ"], categories: ["italian_restaurant", "pizza_restaurant"] },
  { words: ["韓国料理", "韓国"], categories: ["korean_restaurant"] },
  { words: ["海鮮", "魚"], categories: ["seafood_restaurant"] },
  { words: ["ステーキ", "肉"], categories: ["steakhouse"] },
  { words: ["ハンバーガー", "バーガー"], categories: ["burger_restaurant"] },
  { words: ["ピザ"], categories: ["pizza_restaurant"] },
  { words: ["ファストフード", "ファーストフード"], categories: ["fast_food_restaurant"] },
  {
    words: ["スイーツ", "甘味", "デザート", "アイス", "ソフトクリーム"],
    categories: ["desserts", "ice_cream_shop"],
  },
  { words: ["コンビニ"], categories: ["convenience_store"] },
  { words: ["スーパー", "スーパーマーケット"], categories: ["supermarket", "grocery_store"] },
  { words: ["パン", "ベーカリー"], categories: ["bakery"] },
  // Overtureの日本の寺社は`church_cathedral`に入っている(神社も寺も。実データで確認)。
  // `shinto_shrines`は9件しか無く、これだけを見ると神社が丸ごと落ちる
  {
    words: ["神社", "寺", "寺院", "お寺", "神宮", "大社", "参拝"],
    categories: ["church_cathedral", "buddhist_temple", "religious_organization"],
  },
  { words: ["公園"], categories: ["park", "botanical_garden"] },
  {
    words: ["温泉", "銭湯", "風呂", "湯"],
    categories: ["onsen", "natural_hot_springs", "hot_springs", "public_bath_houses"],
  },
  { words: ["ホテル", "宿", "旅館", "泊"], categories: ["hotel", "ryokan", "accommodation"] },
  { words: ["博物館", "美術館"], categories: ["museum", "art_museum", "history_museum"] },
  { words: ["水族館"], categories: ["aquarium"] },
  { words: ["動物園"], categories: ["zoo"] },
  { words: ["駅"], categories: ["train_station", "metro_station", "bus_station"] },
  { words: ["病院", "医院", "クリニック"], categories: ["hospital", "doctor"] },
  { words: ["薬局", "ドラッグストア"], categories: ["pharmacy", "drugstore"] },
  { words: ["書店", "本屋"], categories: ["bookstore"] },
  { words: ["土産", "みやげ", "おみやげ"], categories: ["souvenir_shop", "gift_shop"] },
  {
    words: ["観光", "名所", "見どころ", "史跡"],
    categories: ["attractions_and_activities", "landmark_and_historical_building"],
  },
];

/** その検索語で絞り込めるOvertureのカテゴリ(無ければ空=全文検索だけ) */
export function categoriesForWord(word: string): string[] {
  const q = word.trim();
  if (!q) return [];
  for (const entry of CATEGORY_BY_WORD) {
    if (entry.words.some((w) => q.includes(w))) return entry.categories;
  }
  return [];
}

/** 検索語が無いときに引く既定のカテゴリ(店・見どころに寄せる) */
export const DEFAULT_OVERTURE_CATEGORIES = [
  "restaurant",
  "japanese_restaurant",
  "cafe",
  "bar",
  "hotel",
  "park",
  "attractions_and_activities",
  "landmark_and_historical_building",
  "church_cathedral",
  "museum",
];

/**
 * Overtureのカテゴリ → 画面とカテゴリに使う短い日本語。
 * **表に無いものは英語のまま出す**(空にするより手がかりになる。`_`は空白に開く)
 */
const GENRE_BY_CATEGORY: Record<string, string> = {
  restaurant: "飲食店",
  japanese_restaurant: "和食",
  noodles_restaurant: "麺類",
  sushi_restaurant: "寿司",
  barbecue_restaurant: "焼肉",
  chinese_restaurant: "中華",
  korean_restaurant: "韓国料理",
  italian_restaurant: "イタリアン",
  pizza_restaurant: "ピザ",
  burger_restaurant: "ハンバーガー",
  seafood_restaurant: "海鮮",
  steakhouse: "ステーキ",
  chicken_restaurant: "鶏料理",
  asian_restaurant: "アジア料理",
  fast_food_restaurant: "ファストフード",
  diner: "食堂",
  eat_and_drink: "飲食",
  cafe: "カフェ",
  coffee_shop: "カフェ",
  tea_room: "喫茶",
  bubble_tea: "タピオカ",
  desserts: "スイーツ",
  ice_cream_shop: "アイス",
  bakery: "ベーカリー",
  bar: "バー",
  pub: "パブ",
  sake_bar: "日本酒バー",
  cocktail_bar: "バー",
  wine_bar: "ワインバー",
  beer_bar: "ビアバー",
  beer_garden: "ビアガーデン",
  convenience_store: "コンビニ",
  supermarket: "スーパー",
  grocery_store: "食料品店",
  souvenir_shop: "土産物店",
  gift_shop: "ギフト",
  bookstore: "書店",
  clothing_store: "衣料品店",
  // Overtureの日本の寺社はここに入る(44,648件。神社も寺も)。ただし本物の教会も
  // 混ざっているので、「寺社」と言い切らない
  church_cathedral: "寺社・教会",
  buddhist_temple: "寺院",
  shinto_shrines: "神社",
  religious_organization: "宗教施設",
  park: "公園",
  botanical_garden: "植物園",
  zoo: "動物園",
  aquarium: "水族館",
  onsen: "温泉",
  natural_hot_springs: "温泉",
  hot_springs: "温泉",
  public_bath_houses: "銭湯",
  hotel: "ホテル",
  ryokan: "旅館",
  accommodation: "宿",
  museum: "博物館",
  art_museum: "美術館",
  history_museum: "歴史博物館",
  landmark_and_historical_building: "名所・史跡",
  attractions_and_activities: "観光",
  train_station: "駅",
  metro_station: "駅",
  bus_station: "バス停",
  hospital: "病院",
  doctor: "医院",
  pharmacy: "薬局",
  drugstore: "ドラッグストア",
  parking: "駐車場",
};

/**
 * 地物のジャンル名。**先頭のカテゴリが主タグ**(chiezoが`[category, ...alt]`の順で入れる)
 * なので、そこから順に表に当たり、当たらなければ主タグを読める形にして返す。
 */
export function overtureGenreOf(tags: string[]): string | null {
  for (const tag of tags) {
    const label = GENRE_BY_CATEGORY[tag];
    if (label) return label;
  }
  const head = tags[0];
  return head ? head.replace(/_/g, " ") : null;
}

/**
 * Overtureの`extra.area`(JISの都道府県コード)から都道府県名。
 *
 * **たいてい空**なので、取れないほうが普通だと思って呼ぶこと(実測: 京都駅まわりの
 * 40件はすべて空。新宿では入っているものもあった)。`PREFECTURES`はJISの並び
 * (01 北海道 〜 47 沖縄県)なので、添字で引ける。
 */
export function prefectureFromAreaCode(area: string | null | undefined): string | null {
  if (!area) return null;
  const code = Number(area);
  if (!Number.isInteger(code) || code < 1 || code > PREFECTURES.length) return null;
  return PREFECTURES[code - 1] ?? null;
}

/**
 * 表示名。chiezoは同名の地物を`名前 (連番)`に弁別しているので、そこを外す
 * (OSMの`名前 (node:123)`に当たるもの。連番は数字だけ)
 */
export function stripOvertureSuffix(title: string): string {
  return title.replace(/\s*\(\d+\)$/, "");
}
