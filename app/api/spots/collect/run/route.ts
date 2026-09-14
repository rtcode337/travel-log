import { NextResponse } from "next/server";
import { resolveCollectContext } from "@/lib/spotCollectServer";
import { SWEEP_DEEP } from "@/lib/spotCollect";

/**
 * 予定を待たずに1回集めさせる(spot_admin/admin専用)。
 *
 * **返るのは「起こした」まで。** chiezo側も取り込みを起こしたところで返す作りで、
 * 集め終わったかは分からない —— 集まった頃に`./candidates`で取り出す、という
 * 使い方(レポートを頼んで後で読みに行く)にそのまま合う。
 *
 * **止まっている収集は向こうが403で断る。** 有効にできるのはchiezoの管理画面だけ
 * なので、こちらはその理由をそのまま画面へ出す。
 *
 * **頼み方が3つある。**
 *
 * | 渡すもの | 呼ぶ先 | やること |
 * |---|---|---|
 * | `?sweep=<巡回名>` | `/run` | その巡回を1回、予定を待たずに走らせる |
 * | `?partition=<区画の鍵>` | `/focus` | **この範囲を先に見て**(地図で見ている区画) |
 * | body の `titles` | `/focus` | **この1件を直して**(間違い報告のあったスポット) |
 *
 * **名指しできることが要**。区画を渡すだけでは、直してほしい1件が差し込みに載る
 * 保証がない(その区画の中身が多ければ、途中で切られる)。
 *
 * 割り込みを`run`ではなく`focus`にしてあるのは、**定時の巡回に影響を出さない**ため。
 * `run`は予定も区画の巡回記録も進めるので、割り込むたびに一周が伸びたり、
 * 見ていない区画に印が付いたりする。`focus`はそこを動かさない。
 *
 * **走らせる枠は「じっくり」**(`SWEEP_DEEP`)。割り込み専用の巡回は置いていない ——
 * 頼むのは同じ仕事(疑う・直す・足りないものを足す)なので、設定も依頼文も
 * そこのものでよい(別に持つと、じっくりを育てても割り込みは古い文で走る)。
 */

/** 1回に名指しできる件数。**多すぎると差し込みに載り切らない**(全部は見られない) */
const MAX_FOCUS_TITLES = 20;

export async function POST(request: Request) {
  const ctx = await resolveCollectContext(request);
  if ("error" in ctx) return ctx.error;
  const { baseUrl, source, spotType } = ctx;

  const params = new URL(request.url).searchParams;
  const partition = params.get("partition")?.trim();
  const sweep = params.get("sweep")?.trim();
  const body = await request.json().catch(() => null);
  const titles = Array.isArray(body?.titles)
    ? (body.titles as unknown[])
        .map((t) => (typeof t === "string" ? t.trim() : ""))
        .filter(Boolean)
        .slice(0, MAX_FOCUS_TITLES)
    : [];
  const note = typeof body?.note === "string" ? body.note.trim() : "";

  const focusing = titles.length > 0 || !!partition;
  if (!focusing && !sweep) {
    return NextResponse.json(
      { error: "巡回名・区画・スポット名のどれかを渡してください。" },
      { status: 400 }
    );
  }
  const path = focusing ? "focus" : "run";
  // **何をしてほしいかを書かないと向こうが受け付けない** —— 書かれていない割り込みは
  // 1回ぶんのAIの呼び出しにしかならない(巡回でやれば済む)
  const defaultNote = titles.length
    ? `間違いの報告があった「${spotType.label}」です。実在・所在地・重複を確かめて直してください。`
    : `地図で見ている範囲です。この区画の「${spotType.label}」を集めてください` +
      "(まだ一度も見ていない区画です)。";
  const payload = focusing
    ? {
        note: note || defaultNote,
        ...(titles.length ? { titles } : {}),
        ...(partition ? { partition } : {}),
        // **「じっくり」の枠で走らせる。** 割り込み専用の巡回は置いていない
        sweep: sweep || SWEEP_DEEP,
        requested_by: `travel-log/${spotType.key}`,
      }
    : { sweep };

  try {
    const res = await fetch(
      `${baseUrl}/v1/collect/${encodeURIComponent(source)}/${path}`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "travel-log-personal-app/1.0",
        },
        body: JSON.stringify(payload),
        // 起こすだけなので短くてよい(集め終わるまでは待たない)
        signal: AbortSignal.timeout(15_000),
      }
    );
    const resBody = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = resBody?.detail ?? resBody;
      const message =
        typeof detail === "string"
          ? detail
          : (detail?.error ?? detail?.reason ?? JSON.stringify(detail ?? {}));
      return NextResponse.json({ error: `${res.status}: ${message}` }, { status: 502 });
    }
    return NextResponse.json({ data: resBody ?? { ok: true } });
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
