/**
 * 地図データ(chiezoのOSM辞典)から周辺のスポット候補を引くための語彙と組み立て。
 * **サーバー専用ではない**(語彙表は画面のプレースホルダーにも使う)。
 *
 * 探し方は2つあり、**両方を投げて混ぜる**:
 * - **全文検索**(`/v1/osm_japan/search`): 「ラーメン」「カフェ」のように**名前に出る語**に強い。
 *   実測で新宿の「ラーメン」は店名にラーメンを含む店が並ぶ
 * - **種別での絞り込み**(`/v1/osm_japan/filter?feature=`): 「ランチ」「ごはん」のように
 *   **名前には出ない語**に要る。全文検索だけだと、店名に「ランチ」が入る店しか出ない
 *
 * `feature`はOSMの主タグ1つ(`amenity=restaurant`など)しか受け付けない
 * (`cuisine=ramen`で絞ろうとすると0件。実測)。なので語 → 主タグの表を持つ。
 *
 * **料理の種類はこの形では絞れない**ので、「飲食店すべて」を取ってから
 * `cuisine`タグでこちらが落とす(`cuisinesForWord`。絞り込みは呼び出し側)。
 */

/**
 * 料理の種類で探す語 → `cuisine`タグの値。**主タグでは絞れない**ので、
 * 飲食店すべてを取ってから呼び出し側でこの値と突き合わせる。
 *
 * 名前に料理の種類が出ない店(屋号だけの店)は全文検索では拾えず、
 * ここが唯一の手掛かりになる。
 */
const CUISINE_BY_WORD: { words: string[]; cuisines: string[]; features: string[] }[] = [
  {
    words: ["ラーメン", "らーめん", "ラー麺", "らー麺", "中華そば"],
    cuisines: ["ramen", "noodle", "noodles"],
    features: ["amenity=restaurant", "amenity=fast_food"],
  },
  { words: ["そば", "蕎麦"], cuisines: ["soba"], features: ["amenity=restaurant", "amenity=fast_food"] },
  { words: ["うどん"], cuisines: ["udon"], features: ["amenity=restaurant", "amenity=fast_food"] },
  { words: ["寿司", "すし", "鮨"], cuisines: ["sushi"], features: ["amenity=restaurant"] },
  { words: ["焼肉", "焼き肉"], cuisines: ["yakiniku", "korean"], features: ["amenity=restaurant"] },
  { words: ["焼鳥", "焼き鳥", "やきとり"], cuisines: ["yakitori"], features: ["amenity=restaurant"] },
  { words: ["カレー"], cuisines: ["curry", "indian"], features: ["amenity=restaurant"] },
  { words: ["中華", "中国料理"], cuisines: ["chinese"], features: ["amenity=restaurant"] },
  { words: ["イタリアン", "パスタ"], cuisines: ["italian", "pizza"], features: ["amenity=restaurant"] },
  { words: ["韓国料理"], cuisines: ["korean"], features: ["amenity=restaurant"] },
  { words: ["とんかつ", "トンカツ", "豚カツ"], cuisines: ["tonkatsu"], features: ["amenity=restaurant"] },
  { words: ["天ぷら", "天麩羅"], cuisines: ["tempura"], features: ["amenity=restaurant"] },
  { words: ["ハンバーガー", "バーガー"], cuisines: ["burger"], features: ["amenity=fast_food"] },
  { words: ["ピザ"], cuisines: ["pizza"], features: ["amenity=restaurant", "amenity=fast_food"] },
  { words: ["海鮮", "魚"], cuisines: ["seafood"], features: ["amenity=restaurant"] },
  { words: ["ステーキ"], cuisines: ["steak_house"], features: ["amenity=restaurant"] },
];

/** その検索語が料理の種類を指すなら、突き合わせる`cuisine`の値(無ければ空) */
export function cuisinesForWord(word: string): string[] {
  const q = word.trim();
  if (!q) return [];
  const entry = CUISINE_BY_WORD.find((e) => e.words.some((w) => q.includes(w)));
  return entry?.cuisines ?? [];
}

/** 検索語 → OSMの主タグ。**当てはまらない語は全文検索だけで探す** */
const FEATURE_BY_WORD: { words: string[]; features: string[] }[] = [
  {
    words: ["ランチ", "昼食", "ごはん", "ご飯", "食事", "飲食", "レストラン", "グルメ"],
    features: ["amenity=restaurant", "amenity=cafe", "amenity=fast_food"],
  },
  { words: ["カフェ", "喫茶", "コーヒー", "珈琲"], features: ["amenity=cafe"] },
  { words: ["居酒屋", "バー", "飲み屋", "パブ"], features: ["amenity=bar", "amenity=pub"] },
  { words: ["ファストフード", "ファーストフード"], features: ["amenity=fast_food"] },
  { words: ["コンビニ"], features: ["shop=convenience"] },
  { words: ["スーパー", "スーパーマーケット"], features: ["shop=supermarket"] },
  { words: ["パン", "ベーカリー"], features: ["shop=bakery"] },
  { words: ["神社", "寺", "寺院", "お寺"], features: ["amenity=place_of_worship"] },
  { words: ["公園"], features: ["leisure=park"] },
  { words: ["温泉", "銭湯", "風呂"], features: ["amenity=public_bath"] },
  { words: ["ホテル", "宿", "旅館"], features: ["tourism=hotel", "tourism=guest_house"] },
  { words: ["博物館", "美術館"], features: ["tourism=museum"] },
  { words: ["駅"], features: ["railway=station"] },
  { words: ["病院", "клиника", "医院"], features: ["amenity=hospital", "amenity=clinic"] },
  { words: ["薬局", "ドラッグストア"], features: ["amenity=pharmacy", "shop=chemist"] },
  { words: ["書店", "本屋"], features: ["shop=books"] },
  { words: ["観光", "名所", "見どころ"], features: ["tourism=attraction", "tourism=viewpoint"] },
];

/**
 * その検索語で絞り込めるOSMの主タグ(無ければ空=全文検索だけ)。
 * **料理の種類の語を先に当てる** —— そちらは主タグを広く取ってから
 * `cuisine`で落とす前提なので、当てる表が違う
 */
export function featuresForWord(word: string): string[] {
  const q = word.trim();
  if (!q) return [];
  const byCuisine = CUISINE_BY_WORD.find((e) => e.words.some((w) => q.includes(w)));
  if (byCuisine) return byCuisine.features;
  for (const entry of FEATURE_BY_WORD) {
    if (entry.words.some((w) => q.includes(w))) return entry.features;
  }
  return [];
}

/** OSMの主タグ・cuisineから、画面とカテゴリに使う短い日本語 */
const GENRE_BY_FEATURE: Record<string, string> = {
  "amenity=restaurant": "飲食店",
  "amenity=cafe": "カフェ",
  "amenity=fast_food": "ファストフード",
  "amenity=bar": "バー",
  "amenity=pub": "パブ",
  "shop=convenience": "コンビニ",
  "shop=supermarket": "スーパー",
  "shop=bakery": "ベーカリー",
  "amenity=place_of_worship": "寺社",
  "leisure=park": "公園",
  "amenity=public_bath": "銭湯",
  "tourism=hotel": "ホテル",
  "tourism=guest_house": "宿",
  "tourism=museum": "博物館",
  "tourism=attraction": "観光地",
  "tourism=viewpoint": "展望",
  "railway=station": "駅",
  "amenity=hospital": "病院",
  "amenity=clinic": "医院",
  "amenity=pharmacy": "薬局",
  "shop=books": "書店",
};

/** cuisineタグの短い日本語(主タグより具体的なので、あればこちらを優先) */
const GENRE_BY_CUISINE: Record<string, string> = {
  ramen: "ラーメン",
  sushi: "寿司",
  japanese: "和食",
  chinese: "中華",
  italian: "イタリアン",
  french: "フレンチ",
  indian: "インド料理",
  korean: "韓国料理",
  thai: "タイ料理",
  curry: "カレー",
  soba: "そば",
  udon: "うどん",
  yakiniku: "焼肉",
  yakitori: "焼き鳥",
  pizza: "ピザ",
  burger: "ハンバーガー",
  steak_house: "ステーキ",
  coffee_shop: "カフェ",
  bakery: "ベーカリー",
  friture: "揚げ物",
  donburi: "丼",
  tonkatsu: "とんかつ",
  teppanyaki: "鉄板焼き",
  seafood: "海鮮",
  bento: "弁当",
  sandwich: "サンドイッチ",
};

/**
 * 上位のくくりのcuisine。**同じ店がより具体的な値も持っていればそちらを名乗らせる** ——
 * `japanese;ramen`は先頭を見ると「和食」になるが、ラーメン店として探せなくなる
 */
const BROAD_CUISINES = new Set(["japanese", "asian", "regional", "international", "local"]);

/**
 * 地物のジャンル名。cuisineが具体的ならそちら、無ければ主タグ、
 * どちらも表に無ければ主タグの値をそのまま出す(空にするより手がかりになる)
 */
export function genreOf(feature: string | null, cuisine: string | null): string | null {
  if (cuisine) {
    // `japanese;ramen` のように複数入る。**具体的な値を先に見る**(`BROAD_CUISINES`参照)
    const values = cuisine.split(";").map((v) => v.trim());
    const specific = values.find((v) => !BROAD_CUISINES.has(v) && GENRE_BY_CUISINE[v]);
    const label = specific ?? values.find((v) => GENRE_BY_CUISINE[v]);
    if (label) return GENRE_BY_CUISINE[label];
  }
  if (!feature) return null;
  return GENRE_BY_FEATURE[feature] ?? feature.split("=")[1] ?? null;
}

/** OSMの`addr:*`タグから住所を組む(番地まで。無ければnull) */
export function addressOf(tags: Record<string, unknown>): string | null {
  const get = (key: string) => {
    const v = tags[key];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  // 日本の住所はOSMでも「県→市→町→丁目→番地」の順に入っている
  const parts = [
    get("addr:province") ?? get("addr:state"),
    get("addr:city"),
    get("addr:suburb"),
    get("addr:quarter") ?? get("addr:neighbourhood"),
    get("addr:block_number"),
    get("addr:housenumber"),
  ].filter((p): p is string => !!p);
  return parts.length > 0 ? parts.join("") : null;
}

/** 中心と半径を囲むbbox(`min_lat,min_lon,max_lat,max_lon`) */
export function bboxAround(
  center: { lat: number; lng: number },
  radiusM: number
): string {
  const latPad = radiusM / 111_000;
  const lngPad =
    radiusM / (111_000 * Math.max(Math.cos((center.lat * Math.PI) / 180), 0.1));
  return [
    center.lat - latPad,
    center.lng - lngPad,
    center.lat + latPad,
    center.lng + lngPad,
  ]
    .map((v) => v.toFixed(6))
    .join(",");
}
