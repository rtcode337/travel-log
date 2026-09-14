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
} from "@/lib/spotCollectServer";
import {
  buildPartition,
  buildSweeps,
  COLLECT_SOURCE_SETTING_KEY,
  defaultDeepPrompt,
  defaultExtractWant,
  defaultScanWant,
  isValidCollectSource,
  partitionTarget,
  RETIRED_COLLECT_SETTING_KEYS,
  SWEEP_DEEP,
  SWEEP_SCAN,
  type ChiezoCollection,
  type CollectExtract,
  type CollectLap,
  type SpotCollectStatus,
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
 * **正はchiezo側**(`lib/spotCollect.ts`)。プロンプト2本・抽出条件・区画と増えたので、
 * こちらへ写すとどちらが正か決められなくなる。こちらに残すのは収集名だけ。
 */

/** 巡回ごとの一周の進み具合。**区画の記録から数える** */
function lapsOf(collection: ChiezoCollection | null): CollectLap[] {
  const partitions = collection?.partitions ?? [];
  return [SWEEP_SCAN, SWEEP_DEEP].map((name) => ({
    name,
    total: partitions.length,
    visited: partitions.filter((p) => p.visits?.[name]).length,
  }));
}

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
          collection: null,
          partitionCount: 0,
          laps: [],
          ingest: null,
          backends: [],
          draftExtractWant: "",
          draftScanWant: "",
          defaultDeepPrompt: "",
        },
      });
    }
    return ctx.error;
  }
  const { spotType, baseUrl, source } = ctx;
  // **1件ぶんの口で引く**(区画の一覧が返るのはこちらだけ)。
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
    collection,
    partitionCount: collection?.partitions?.length ?? 0,
    laps: lapsOf(collection),
    ingest,
    backends,
    draftExtractWant: defaultExtractWant(spotType.label),
    draftScanWant: defaultScanWant(
      spotType.label,
      collection?.extract?.source || "overture_japan"
    ),
    defaultDeepPrompt: defaultDeepPrompt(spotType.label),
  };
  return NextResponse.json({ data });
}

/**
 * 依頼する(まだ無ければ作る・あれば差し替える)。
 *
 * **作り直さず差し替える。** 収集はソースそのものなので、作り直すと溜めたものが消える
 * (chiezo側に削除の口はあるが、こちらから消しにいくものではない)。
 *
 * **区画も巡回もここで組んで渡す。** 抽出条件とプロンプトはAIが書いたものを通すだけだが、
 * 「どう回すか」(週1の名簿・3日で一周のざっと・7日で一周のじっくり)はアプリの決め事なので
 * こちらが決める —— 種別ごとにばらつくと、画面に出す進み具合の読み方も種別ごとに変わる。
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
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const scanPrompt = text(body?.scanPrompt);
  const deepPrompt = text(body?.deepPrompt) || defaultDeepPrompt(spotType.label);
  const extract = (body?.extract ?? null) as CollectExtract | null;
  if (!scanPrompt) {
    return NextResponse.json(
      { error: "「ざっと」のプロンプトを入力してください。" },
      { status: 400 }
    );
  }
  if (!extract?.source) {
    return NextResponse.json(
      { error: "抽出条件がありません。先にAIに書かせてください。" },
      { status: 400 }
    );
  }
  if (!text(extract.tag)) {
    // **区画はタグでしか絞れない。** ソース全体を母集団にすると50万点の上限に
    // 当たってchiezoが断るので、投げる前にこちらで理由を伝える
    return NextResponse.json(
      {
        error:
          "抽出条件にタグが入っていません。区画は母集団をタグで絞る必要があるので、" +
          "依頼文でジャンルを具体的に書いて書き直させてください。",
      },
      { status: 400 }
    );
  }
  // 相手・モデル・深さ。**空文字は「指定しない」**として向こうへ渡す
  const choice = {
    backend: text(body?.backend),
    model: text(body?.model),
    effort: text(body?.effort),
  };
  // **区画の細かさは母集団の件数から逆算する**(下書きが引いた件数が来る)。
  // 分からなければ書かず、chiezoの既定に任せる
  const population = Number(body?.population);
  const target = Number.isFinite(population) && population > 0
    ? partitionTarget(population)
    : undefined;

  const definition = {
    description: `${spotType.label}のスポット候補`,
    prompt: scanPrompt,
    // **網羅**(ある括りの全部を集めて精査し続ける)。流れではないので期限で落とさない
    kind: "stock",
    extract,
    partition: buildPartition(extract, target),
    sweeps: buildSweeps({ deepPrompt, choice }),
    ...choice,
  };

  const existing = await findCollection(baseUrl, source);
  const { error } = existing
    ? await chiezo(baseUrl, `/v1/collect/${encodeURIComponent(source)}`, {
        method: "PATCH",
        body: JSON.stringify(definition),
      })
    : await chiezo(baseUrl, "/v1/collect", {
        method: "POST",
        body: JSON.stringify({
          name: source,
          ...definition,
          // 巡回が自分の時計を持つので、収集そのものの間隔は使われない
          interval_minutes: 360,
          // 新しい店は地図辞典に無いので、外を見られるようにしておく
          web: true,
          // **出どころを名乗る。** 有効にするか決めるのは向こうの人なので、
          // どのアプリのどの種別が頼んだのかが一覧から読めるようにする
          requested_by: `travel-log/${spotType.key}`,
        }),
      });
  if (error) return NextResponse.json({ error }, { status: 502 });

  // 収集名はこちらが正。**依頼が通ってから保存する** ——
  // 先に保存すると、断られた設定が残って次から差分が出なくなる
  await query(
    `insert into spot_type_settings (spot_type_id, key, value)
     values ($1, $2, $3)
     on conflict (spot_type_id, key) do update set value = excluded.value`,
    [spotType.id, COLLECT_SOURCE_SETTING_KEY, source]
  );
  // 市区町村カーソル方式だった頃の設定を片付ける(読む側はもう無い)
  await query(`delete from spot_type_settings where spot_type_id = $1 and key = any($2)`, [
    spotType.id,
    RETIRED_COLLECT_SETTING_KEYS,
  ]);
  return NextResponse.json({ data: await fetchCollection(baseUrl, source) });
}
