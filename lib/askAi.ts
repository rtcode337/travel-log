import type { Spot } from "@/lib/types";

/**
 * スポットについて生成AIに聞くための質問文と、その質問を入れた状態でAIのページを
 * 開くURLを組み立てる。スポット詳細のClaude・Geminiのボタンで使う。
 *
 * **同名の別スポットに答えられてしまうのを防ぐため、質問文に所在地と座標を添える**
 * (「光明寺」のように同じ名前の場所が各地にあるため)。
 */

/** 質問文。AIのページのテキストボックスにこの文字列が入る */
export function buildSpotQuestion(spot: Spot): string {
  const where = [spot.region, `${spot.lat.toFixed(5)},${spot.lng.toFixed(5)}`]
    .filter(Boolean)
    .join(" / ");
  return (
    `「${spot.name}」(${where})について教えてください。` +
    `どんな場所で何が見どころか、歴史や由来、` +
    `訪れるときに知っておくとよいこと(見学の所要時間・混む時期・近くの立ち寄り先)を知りたいです。`
  );
}

/**
 * Claudeを新しい会話で開くURL。`q`はプロンプト欄に入った状態で開く公式の
 * パラメータ(送信はされないので、送る前に読み返せる)。
 */
export function buildClaudeAskUrl(spot: Spot): string {
  return `https://claude.ai/new?q=${encodeURIComponent(buildSpotQuestion(spot))}`;
}

/**
 * Gemini(Google検索のAIモード)で開くURL。
 * **gemini.google.com はURLでプロンプトを渡せない**ため、同じGeminiのモデルが
 * 答えるAIモード(`udm=50`)を使う。検索ボックスに質問文が入った状態で回答が出る。
 * gemini.google.com側がURLでの事前入力に対応したら、そちらへ変えられる。
 */
export function buildGeminiAskUrl(spot: Spot): string {
  return `https://www.google.com/search?udm=50&q=${encodeURIComponent(
    buildSpotQuestion(spot)
  )}`;
}
