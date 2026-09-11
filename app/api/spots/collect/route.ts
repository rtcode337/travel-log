import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSpotTypeSetting } from "@/lib/types";
import {
  chiezo,
  findCollection,
  resolveCollectContext,
  type SpotCollectStatus,
} from "@/lib/spotCollectServer";
import {
  COLLECT_INTERVAL_MINUTES,
  COLLECT_PROMPT_SETTING_KEY,
  COLLECT_SOURCE_SETTING_KEY,
  defaultCollectPrompt,
  isValidCollectSource,
  resolveCollectSource,
} from "@/lib/spotCollect";

/**
 * 「情報を集めさせる」の依頼と状態(spot_admin/admin専用)。
 *
 * **周辺を探すの、待たない版。** あちらはその場で探して数十秒で返すので、探せる範囲も
 * 精度も1回の待ち時間で頭打ちになる。こちらは知識サーバー(chiezo)の収集へ**依頼だけ
 * して離れ**、集まった頃に取り出す(取り出しは`./candidates`)。
 *
 * **依頼しても勝手には走らない。** chiezoは外から作られた収集を必ず止めた状態で置き、
 * 有効にできるのはあちらの管理画面だけ(RESTから`enabled`は触れない)—— 呼んだだけで
 * AIが動かないことが、あの口を外へ開けておける理由なので、こちらもそれに乗る。
 * 画面は止まっている間その旨を出す。
 *
 * **プロンプトはこちらに持つ**(`collect_prompt`)。何を集めさせるかは種別の設定の
 * 一部で、種別を作り直したときに向こうへ取りに行かずに済む。chiezo側にも同じものが
 * 渡るが、正はこちら。
 */

export async function GET(request: Request) {
  const ctx = await resolveCollectContext(request);
  if ("error" in ctx) {
    // **使えない理由で画面ごと落とさない。** メニューを出すかの判断に使うので、
    // 接続先が無いだけなら「使えない」を返して普通に描かせる
    if (ctx.error.status === 503) {
      return NextResponse.json({
        data: { available: false, source: "", prompt: "", collection: null },
      });
    }
    return ctx.error;
  }
  const { spotType, baseUrl, source } = ctx;
  const data: SpotCollectStatus = {
    available: !!getSpotTypeSetting(spotType, "ai_discovery_enabled"),
    source,
    prompt:
      spotType.settings?.[COLLECT_PROMPT_SETTING_KEY]?.trim() ||
      defaultCollectPrompt(spotType.label),
    collection: await findCollection(baseUrl, source),
  };
  return NextResponse.json({ data });
}

/**
 * 依頼する(まだ無ければ作る・あればプロンプトを差し替える)。
 *
 * **作り直さず差し替える。** 収集はソースそのものなので、作り直すと溜めたものが消える
 * (chiezo側に削除の口はあるが、こちらから消しにいくものではない)。
 */
export async function POST(request: Request) {
  const ctx = await resolveCollectContext(request);
  if ("error" in ctx) return ctx.error;
  const { spotType, baseUrl, source } = ctx;

  if (!isValidCollectSource(source)) {
    return NextResponse.json(
      { error: `収集名「${source}」は使えません(英小文字で始まる2〜31文字)。` },
      { status: 400 }
    );
  }
  const body = await request.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) {
    return NextResponse.json({ error: "プロンプトを入力してください。" }, { status: 400 });
  }

  const existing = await findCollection(baseUrl, source);
  const { error } = existing
    ? await chiezo(baseUrl, `/v1/collect/${encodeURIComponent(source)}`, {
        method: "PATCH",
        body: JSON.stringify({ prompt, description: `${spotType.label}のスポット候補` }),
      })
    : await chiezo(baseUrl, "/v1/collect", {
        method: "POST",
        body: JSON.stringify({
          name: source,
          description: `${spotType.label}のスポット候補`,
          prompt,
          interval_minutes: COLLECT_INTERVAL_MINUTES,
          // **出どころを名乗る。** 有効にするか決めるのは向こうの人なので、
          // どのアプリのどの種別が頼んだのかが一覧から読めるようにする
          requested_by: `travel-log/${spotType.key}`,
        }),
      });
  if (error) return NextResponse.json({ error }, { status: 502 });

  // プロンプトと収集名はこちらが正。**依頼が通ってから保存する** ——
  // 先に保存すると、断られた設定が残って次から差分が出なくなる
  for (const [key, value] of [
    [COLLECT_PROMPT_SETTING_KEY, prompt],
    [COLLECT_SOURCE_SETTING_KEY, source],
  ] as const) {
    await query(
      `insert into spot_type_settings (spot_type_id, key, value)
       values ($1, $2, $3)
       on conflict (spot_type_id, key) do update set value = excluded.value`,
      [spotType.id, key, value]
    );
  }
  return NextResponse.json({ data: await findCollection(baseUrl, source) });
}
