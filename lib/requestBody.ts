import { NextResponse } from "next/server";
import { MAX_PHOTOS_PER_VISIT } from "@/lib/visitPhoto";
import { MAX_PHOTO_BASE64_LENGTH } from "@/lib/photos";

/**
 * Route Handlerが受け取るJSON本文の大きさの上限(サーバー専用)。
 *
 * Route Handlerには既定の上限が無く、`request.json()`は本文を最後まで読んでから
 * 中身を検査する。写真の枚数・1枚の大きさの検査はその後なので、巨大な本文を送られると
 * 検査の前にメモリを使い切りうる。**読みながら数え、上限を超えたらそこで打ち切る**。
 */

/** 写真つきの本文の上限。1件の写真の上限(枚数×1枚)に、本文ぶんの余裕を足したもの */
export const PHOTO_BODY_MAX_BYTES =
  MAX_PHOTOS_PER_VISIT * MAX_PHOTO_BASE64_LENGTH + 1_000_000;

/** メモ・追記・口コミの本文の上限(文字数)。読み物としては十分で、DBを膨らませない程度 */
const MAX_TEXT_LENGTH = 10_000;

/**
 * 本文を上限つきで読み、JSONとして返す。超えたら413、壊れていたら400の応答を`response`で返す
 * (呼び出し側はそれをそのまま返す)。`Content-Length`があれば読む前に断り、
 * 無ければ(分割転送)読みながら数える。`body`は request.json() と同じく any
 * (中身は呼び出し側で検査する)
 */
export async function parseJsonBody(
  request: Request,
  maxBytes: number
  // biome-ignore lint/suspicious/noExplicitAny: request.json() と同じく、中身の検査は呼び出し側で行う
): Promise<{ body: any; response?: undefined } | { body?: undefined; response: NextResponse }> {
  const tooLarge = {
    response: NextResponse.json({ error: "送信するデータが大きすぎます。" }, { status: 413 }),
  };
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return tooLarge;

  const chunks: Uint8Array[] = [];
  let total = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return tooLarge;
      }
      chunks.push(value);
    }
  }
  try {
    return { body: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return {
      response: NextResponse.json(
        { error: "リクエストの形式が正しくありません。" },
        { status: 400 }
      ),
    };
  }
}

/** 文字列の長さが上限を超えていればtrue(文字列以外は対象外) */
export function isTooLong(value: unknown, max = MAX_TEXT_LENGTH): boolean {
  return typeof value === "string" && value.length > max;
}
