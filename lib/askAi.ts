import type { Spot, SpotType } from "@/lib/types";

/**
 * スポットについて生成AIに聞くための質問文と、その質問を入れた状態でAIのページを
 * 開くURLを組み立てる。スポット詳細の「AIに聞く」ボタンとGeminiのボタンで使う。
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
 * 見どころや歴史はそのあとに読むもの —— かつては見どころから始めて営業時間を
 * 最後の丸かっこに入れており、**アクセスに至っては聞いてすらいなかった**。
 * 長い前置きの先に実務的な情報があると、スクロールして探すことになる。
 *
 * **当てはまらないスポットもある。** ご当地グルメのように施設ではない種別では
 * 営業時間もアクセスも意味を成さないので、その場合は一言で飛ばすよう頼んである
 * (種別は利用者が増やせるので、アプリ側で出し分けられない)。
 */

/** 質問文。AIのページのテキストボックスにこの文字列が入る */
export function buildSpotQuestion(
  spot: Spot,
  spotType?: SpotType | null
): string {
  const where = [spot.region, `${spot.lat.toFixed(5)},${spot.lng.toFixed(5)}`]
    .filter(Boolean)
    .join(" / ");
  const typeContext = spotType
    ? `このスポットは「${spotType.label}」として記録しています。` +
      `その種別の場所として何が魅力かという観点も踏まえて教えてください。`
    : "";
  return (
    `「${spot.name}」(${where})について教えてください。` +
    typeContext +
    `まず最初に、訪れるのに要ることを箇条書きで手短に: ` +
    `(1) 営業時間・定休日(季節で変わるならその違いも)、` +
    `(2) アクセス(最寄り駅・バス停からの経路と所要時間、車なら駐車場の有無)、` +
    `(3) 入場料・拝観料の有無と目安。` +
    `そのあとで、どんな場所で何が見どころか、歴史や由来、` +
    `見学の所要時間、混む時期、近くの立ち寄り先を教えてください。` +
    `営業時間とアクセスは変わりやすいので、確かでないところはそう言い添え、` +
    `分かれば公式サイトのURLも教えてください。` +
    `施設ではなく営業時間やアクセスが当てはまらない場合は、そう一言だけ書いて先へ進んでください。`
  );
}

/**
 * 「AIに聞く」で選べる相手。**ここに1行足せばボタンが増える**。
 *
 * URLで質問文を渡せるサービスだけを載せている。**渡し方も挙動もサービスごとに違い、
 * しかも予告なく変わる**ので、確認した時点の挙動をそれぞれに書いてある。
 * 動かなくなったらこの配列から外せばよい(画面側は配列をそのまま並べるだけ)。
 *
 * Geminiはここに入れない —— gemini.google.com はURLで質問文を渡せず、代わりに使っている
 * 検索のAIモードは「履歴の残らないWeb検索」に近い性格なので、Google マップと同じ並びに
 * 置いてある(buildGeminiAskUrl)。
 */
export interface AskAiTarget {
  id: string;
  /** メニューに出す名前 */
  label: string;
  /** 押したときに開くURL */
  buildUrl: (spot: Spot, spotType?: SpotType | null) => string;
  /**
   * メニューに小さく添える、送信されるかどうかの違い。
   * **押して確かめた結果を書くこと**（各サービスの告知と実際の挙動は食い違うことがある。
   * ChatGPTは「外部リンクからは自動送信しない」と告知されているが実際は送信される）。
   */
  note: string;
}

export const ASK_AI_TARGETS: AskAiTarget[] = [
  {
    id: "claude",
    label: "Claude",
    // `q`はプロンプト欄を埋めるだけで送信はしない公式のパラメータ
    buildUrl: (spot, spotType) =>
      `https://claude.ai/new?q=${encodeURIComponent(buildSpotQuestion(spot, spotType))}`,
    note: "送信前に読み返せる",
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    // `q`はネイティブ対応。**そのまま送信される**(2026-08にこのアプリから実際に押して確認)。
    // OpenAIはsec-fetch-siteを見た自動送信の抑止を入れたと告知しているが、
    // 少なくとも外部サイトからのこの遷移では送信まで進む。挙動は変わりうるので、
    // 送信の有無が変わったらこのnoteを直すこと
    buildUrl: (spot, spotType) =>
      `https://chatgpt.com/?q=${encodeURIComponent(buildSpotQuestion(spot, spotType))}`,
    note: "そのまま回答が出る",
  },
  {
    id: "perplexity",
    label: "Perplexity",
    buildUrl: (spot, spotType) =>
      `https://www.perplexity.ai/search?q=${encodeURIComponent(buildSpotQuestion(spot, spotType))}`,
    note: "そのまま回答が出る",
  },
  {
    id: "grok",
    label: "Grok",
    buildUrl: (spot, spotType) =>
      `https://grok.com/?q=${encodeURIComponent(buildSpotQuestion(spot, spotType))}`,
    note: "そのまま回答が出る",
  },
];

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
