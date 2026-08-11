import type { Spot, SpotType } from "@/lib/types";

/**
 * スポットについて生成AIに聞くための質問文と、その質問を入れた状態でAIのページを
 * 開くURLを組み立てる。スポット詳細のClaude・Geminiのボタンで使う。
 *
 * **同名の別スポットに答えられてしまうのを防ぐため、質問文に所在地と座標を添える**
 * (「光明寺」のように同じ名前の場所が各地にあるため)。
 *
 * あわせて**スポット種別の表示名を添える**。同じ場所でも「観光地」として見るのと
 * 「アニメの聖地」として見るのとで知りたいことが違うため、種別を伝えて答えの
 * 観点を寄せてもらう。種別は利用者が自由に増やせるので、種別ごとの質問文を
 * アプリ側に持たず、表示名をそのまま渡す形にしてある。
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
    `どんな場所で何が見どころか、歴史や由来、` +
    `訪れるときに知っておくとよいこと` +
    `(営業時間や定休日・入場料や拝観料があるかどうかとその目安、` +
    `見学の所要時間、混む時期、近くの立ち寄り先)を知りたいです。`
  );
}

/**
 * Claudeを新しい会話で開くURL。`q`はプロンプト欄に入った状態で開く公式の
 * パラメータ(送信はされないので、送る前に読み返せる)。
 */
export function buildClaudeAskUrl(
  spot: Spot,
  spotType?: SpotType | null
): string {
  return `https://claude.ai/new?q=${encodeURIComponent(
    buildSpotQuestion(spot, spotType)
  )}`;
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
  return `https://www.google.com/search?udm=50&q=${encodeURIComponent(
    buildSpotQuestion(spot, spotType)
  )}`;
}
