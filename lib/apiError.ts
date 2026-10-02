import { NextResponse } from "next/server";

/**
 * Route Handlerで捕まえた例外を、利用者向けの応答にする(サーバー専用)。
 *
 * **pgのエラーメッセージをそのまま返さない。** 制約名・列名・SQLの断片が含まれ、
 * 読み手の役にも立たない。詳細はサーバーのログにだけ残し(`docker compose logs app`)、
 * 応答には原因の種類が分かる程度の日本語を返す —— CSVの取り込みで失敗したときに
 * 「何を直せばよいか」の手掛かりは要るので、よくある制約違反だけは言い分ける。
 */
const PG_MESSAGES: Record<string, string> = {
  "23505": "同じ値のデータが既にあります(キーや名前の重複)。",
  "23503": "参照先のデータが見つかりません(削除済みのスポットなど)。",
  "23514": "許されていない値が含まれています。",
  "23502": "必須の値が入っていません。",
  "22P02": "値の形式が正しくありません(数値やIDの書き方)。",
  "22001": "値が長すぎます。",
  "22003": "数値が範囲を超えています。",
};

export function errorResponse(
  err: unknown,
  fallback: string,
  context: string,
  status = 500
): NextResponse {
  console.error(`${context}:`, err);
  const code =
    typeof err === "object" && err !== null && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  const known = PG_MESSAGES[code];
  return NextResponse.json(
    { error: known ? `${fallback} ${known}` : fallback },
    { status: known ? 400 : status }
  );
}
