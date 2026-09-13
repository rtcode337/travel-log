import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getSpotTypeSetting } from "@/lib/types";
import { fetchDiscoveryBackends } from "@/lib/aiDiscoveryConfig";
import {
  chiezo,
  fetchCollection,
  fetchIngestStatus,
  findCollection,
  resolveCollectContext,
  type SpotCollectStatus,
} from "@/lib/spotCollectServer";
import {
  COLLECT_INTERVAL_MINUTES,
  COLLECT_ORIGIN_PLACEHOLDER,
  COLLECT_ORIGIN_SETTING_KEY,
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
        data: {
          available: false,
          source: "",
          prompt: "",
          origin: "",
          collection: null,
          ingest: null,
          backends: [],
        },
      });
    }
    return ctx.error;
  }
  const { spotType, baseUrl, source } = ctx;
  // **1件ぶんの口で引く**(回り終えた地域まで返るのはこちらだけ)。
  // 取り込みの状態と一緒に引くので、どちらも並列でよい
  const [collection, ingest, backends] = await Promise.all([
    fetchCollection(baseUrl, source),
    fetchIngestStatus(baseUrl),
    // **周辺を探すと同じ口から配る** —— 選べる相手・モデル・深さは
    // 収集でも同じものなので、2通りに持たない
    fetchDiscoveryBackends(baseUrl),
  ]);
  const data: SpotCollectStatus = {
    available: !!getSpotTypeSetting(spotType, "ai_discovery_enabled"),
    source,
    prompt:
      spotType.settings?.[COLLECT_PROMPT_SETTING_KEY]?.trim() ||
      defaultCollectPrompt(spotType.label),
    origin: spotType.settings?.[COLLECT_ORIGIN_SETTING_KEY] ?? "",
    collection,
    ingest,
    backends,
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
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  // **収集の起点**。ここから外へ同心円を広げるように埋めさせる。
  // `{origin}`は知識サーバーの知らない印なので、**渡す前にこちらで置き換える**
  // (`{cursor}`・`{covered}`はあちらが解決する)
  const origin = text(body?.origin);
  const sentPrompt = prompt.split(COLLECT_ORIGIN_PLACEHOLDER).join(
    origin || "(指定なし。どこから始めてもよい)"
  );
  // **次に集める地域**。空ならAIに決めさせる
  const cursor = text(body?.cursor) || origin;
  // 相手・モデル・深さ。**空文字は「指定しない」**として向こうへ渡す
  // (あちらのPATCHが空文字をnullへ倒すので、選び直して外せる)
  const choice = {
    backend: text(body?.backend),
    model: text(body?.model),
    effort: text(body?.effort),
  };

  const existing = await findCollection(baseUrl, source);
  const { error } = existing
    ? await chiezo(baseUrl, `/v1/collect/${encodeURIComponent(source)}`, {
        method: "PATCH",
        body: JSON.stringify({
          prompt: sentPrompt,
          description: `${spotType.label}のスポット候補`,
          interval_minutes: COLLECT_INTERVAL_MINUTES,
          cursor,
          ...choice,
        }),
      })
    : await chiezo(baseUrl, "/v1/collect", {
        method: "POST",
        body: JSON.stringify({
          name: source,
          description: `${spotType.label}のスポット候補`,
          prompt: sentPrompt,
          interval_minutes: COLLECT_INTERVAL_MINUTES,
          ...choice,
          // **出どころを名乗る。** 有効にするか決めるのは向こうの人なので、
          // どのアプリのどの種別が頼んだのかが一覧から読めるようにする
          requested_by: `travel-log/${spotType.key}`,
        }),
      });
  if (error) return NextResponse.json({ error }, { status: 502 });
  // 作った直後は`cursor`を渡せない(あちらの作成は受け取らない)ので、
  // **始点が指定されていれば作ったあとに入れる**
  if (!existing && cursor) {
    await chiezo(baseUrl, `/v1/collect/${encodeURIComponent(source)}`, {
      method: "PATCH",
      body: JSON.stringify({ cursor }),
    });
  }

  // プロンプトと収集名はこちらが正。**依頼が通ってから保存する** ——
  // 先に保存すると、断られた設定が残って次から差分が出なくなる
  // **こちらに残すのは置き換える前のプロンプト**(`{origin}`のまま)。
  // 起点を変えたときに差し込み直せるようにするため
  for (const [key, value] of [
    [COLLECT_PROMPT_SETTING_KEY, prompt],
    [COLLECT_SOURCE_SETTING_KEY, source],
    [COLLECT_ORIGIN_SETTING_KEY, origin],
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
