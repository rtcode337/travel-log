import type { Spot, SpotType } from "@/lib/types";

/**
 * スポットについて生成AIに聞くための質問文と、その質問を入れた状態でAIのページを
 * 開くURLを組み立てる。スポット詳細のGeminiのボタンで使う。
 *
 * **聞く相手はGeminiだけにしてある。** かつては押してから相手(Claude・ChatGPT・
 * Perplexity・Grok)を選ぶボタンを別に並べていたが、渡し方も送信されるかどうかも
 * サービスごとに違ううえ予告なく変わり、確かめ直す手間に見合わなかった。
 *
 * **同名の別スポットに答えられてしまうのを防ぐため、質問文に所在地と座標を添える**
 * (「光明寺」のように同じ名前の場所が各地にあるため)。
 *
 * あわせて**スポット種別の表示名を添える**。同じ場所でも「観光地」として見るのと
 * 「アニメの聖地」として見るのとで知りたいことが違うため、種別を伝えて答えの
 * 観点を寄せてもらう。種別は利用者が自由に増やせるので、種別ごとの質問文を
 * アプリ側に持たず、表示名をそのまま渡す形にしてある。
 *
 * **答えの順番まで指定する。** 行けるかどうかを決めるのは営業時間とアクセスで、
 * 次に知りたいのはそこで何を頼む・買う・見るか(名物・おすすめ)。由来や混み具合は
 * そのあとに読むもの —— かつては見どころから始めて営業時間を最後の丸かっこに
 * 入れており、**アクセスに至っては聞いてすらいなかった**。
 *
 * 質問文は短く保つ。Googleは質問文の入ったリンクを開くと「この検索を続行しますか?」
 * と質問文を見せて確かめさせ、質問文を最後までスクロールしないと続行のボタンを
 * 押せない。400字近くあった頃は、スマホでは毎回スクロールが要った。
 * 細かい注文(アクセスの内訳・施設でないときの逃げ道)は削り、聞く項目だけを並べている。
 *
 * **聞く名前はスポットの`ask_name`を先に使う**(空なら`name`)。地図に出す名前と、
 * 調べたい相手の名前が違うスポットがあるため —— 料理名で並べるご当地グルメでは、
 * 料理名で聞くと料理の説明が返り、行き先(代表の店)の営業時間やアクセスが分からない。
 * 何を入れるかはデータの側が決める(アプリは「聞くときはこちらの名前で」としか知らない)。
 */

/** 生成AIに聞くときの名前を整える(前後の空白を落とし、空ならnull=`name`で聞く) */
export function normalizeAskName(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** 質問文。AIのページのテキストボックスにこの文字列が入る */
function buildSpotQuestion(
  spot: Spot,
  spotType?: SpotType | null
): string {
  const where = [spot.region, `${spot.lat.toFixed(5)},${spot.lng.toFixed(5)}`]
    .filter(Boolean)
    .join(" / ");
  const typeContext = spotType ? `「${spotType.label}」として記録しています。` : "";
  const askName = normalizeAskName(spot.ask_name) ?? spot.name;
  return (
    `「${askName}」(${where})について。` +
    typeContext +
    `営業時間・定休日、アクセス、料金を先に箇条書きで。` +
    `次に名物やおすすめ(料理・品・見どころ)を。` +
    `そのあと由来・所要時間・混む時期・近くの立ち寄り先を。` +
    `不確かな点はそう書き、公式サイトのURLも。`
  );
}

/**
 * Gemini(Google検索のAIモード)で開くURL。
 * **gemini.google.com はURLでプロンプトを渡せない**ため、同じGeminiのモデルが
 * 答えるAIモード(`udm=50`)を使う。検索ボックスに質問文が入った状態で回答が出る。
 * gemini.google.com側がURLでの事前入力に対応したら、そちらへ変えられる。
 */
export function buildGeminiAskUrl(
  spot: Spot,
  spotType?: SpotType | null
): string {
  return buildGeminiSearchUrl(buildSpotQuestion(spot, spotType));
}

/**
 * 任意の質問文でGemini(Google検索のAIモード)を開くURL。
 * **「Geminiをどう開くか」はここ1か所に置く** —— 上記のとおり渡し方に癖があり、
 * 変わったときに直す場所を散らさないため(天気の質問もこれを使う。lib/weather.ts)。
 */
export function buildGeminiSearchUrl(question: string): string {
  return `https://www.google.com/search?udm=50&q=${encodeURIComponent(question)}`;
}
