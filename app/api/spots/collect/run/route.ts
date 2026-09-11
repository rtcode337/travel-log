import { NextResponse } from "next/server";
import { resolveCollectContext } from "@/lib/spotCollectServer";

/**
 * 予定を待たずに1回集めさせる(spot_admin/admin専用)。
 *
 * **返るのは「起こした」まで。** chiezo側も取り込みを起こしたところで返す作りで、
 * 集め終わったかは分からない —— 集まった頃に`./candidates`で取り出す、という
 * 使い方(レポートを頼んで後で読みに行く)にそのまま合う。
 *
 * **止まっている収集は向こうが403で断る。** 有効にできるのはchiezoの管理画面だけ
 * なので、こちらはその理由をそのまま画面へ出す。
 */
export async function POST(request: Request) {
  const ctx = await resolveCollectContext(request);
  if ("error" in ctx) return ctx.error;
  const { baseUrl, source } = ctx;
  try {
    const res = await fetch(
      `${baseUrl}/v1/collect/${encodeURIComponent(source)}/run`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "User-Agent": "travel-log-personal-app/1.0",
        },
        // 起こすだけなので短くてよい(集め終わるまでは待たない)
        signal: AbortSignal.timeout(15_000),
      }
    );
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = body?.detail ?? body;
      const message =
        typeof detail === "string"
          ? detail
          : (detail?.error ?? detail?.reason ?? JSON.stringify(detail ?? {}));
      return NextResponse.json({ error: `${res.status}: ${message}` }, { status: 502 });
    }
    return NextResponse.json({ data: body ?? { ok: true } });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "知識サーバーに繋がりませんでした。",
      },
      { status: 502 }
    );
  }
}
