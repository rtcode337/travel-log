import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  ALLOWED_STATUS_BY_ROLE,
  getSpotTypeSetting,
  MODERATION_ROLES,
  SPOT_ADMIN_ROLES,
  SPOTS_PAGE_SIZE,
  type SpotType,
  type Spot,
} from "@/lib/types";
import { SPOT_TYPE_SELECT } from "@/lib/spot-types-query";
import {
  mergeSeriesStyles,
  resolveSeriesStyles,
  SERIES_STYLES_SETTING_KEY,
} from "@/lib/seriesStyle";
import { parseRank, RANKS } from "@/lib/rank";
import { CATEGORIES_SETTING_KEY, mergeCategories, resolveCategories } from "@/lib/category";

// 大量のスポット・写真を1リクエストで捌くため、既定(10秒)では足りない
// (Vercelのサーバーレス関数の上限。指定の無いホストでは無視される)
export const maxDuration = 60;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  // URL(/[type]/map・/[type]/spots)のスポット種別キーを常に必須にする
  // (app_settingsの既定はログイン後リダイレクト先の決定にのみ使う。GET /api/spots自体では見ない)
  const typeKey = searchParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }

  const { rows: typeRows } = await query<SpotType>(
    `${SPOT_TYPE_SELECT} where t.key = $1`,
    [typeKey]
  );
  const activeType = typeRows[0];
  // public_visible設定がfalse(既定)の種別はadmin/spot_admin以外には存在自体を見せない
  // (ページ側の404と揃える。管理画面が全statusのスポットを読むためadmin側は素通し)
  if (
    !activeType ||
    (!getSpotTypeSetting(activeType, "public_visible") && !SPOT_ADMIN_ROLES.includes(user.role))
  ) {
    return NextResponse.json({ error: "存在しない種別です。" }, { status: 404 });
  }

  const baseConditions = ["spot_type_id = $2"];
  const params: unknown[] = [user.id, activeType.id];

  // private(非公開)は常に本人のみ。moderator以上は承認待ち・却下も全件見えるが、
  // それ以外(一般ユーザー)は公開または本人の分しか見えない
  baseConditions.push(
    MODERATION_ROLES.includes(user.role)
      ? "(status != 'private' or created_by = $1)"
      : "(status = 'published' or created_by = $1)"
  );

  if (status) {
    params.push(status);
    baseConditions.push(`status = $${params.length}`);
  }

  // pageが指定されない呼び出し元(自分の非公開スポット取得・管理画面の件数集計等)は
  // 従来通り全件返す。シリーズから探す画面(重い一覧)のみ検索・シリーズ絞り込み込みで
  // ページングする
  const pageParam = searchParams.get("page");
  if (!pageParam) {
    // 公開スポットのダウンロードは数万件・数MBになるため、`limit`/`offset`で
    // 分けて取れるようにしてある(**レスポンスボディに上限のあるホスト向け** ——
    // Vercelのサーバーレス関数は4.5MBを超えると関数側でエラーになる)。
    // 指定が無ければ全件を1回で返す(自分の非公開スポット取得・管理画面の
    // CSV差分など、件数が知れている呼び出し元はこちらを使う)
    const limit = Math.max(0, Number(searchParams.get("limit")) || 0);
    const offset = Math.max(0, Number(searchParams.get("offset")) || 0);
    // 並びに`id`を足して全順序にする —— region・nameだけでは同値の行の順が
    // 実行ごとに変わりうるため、`offset`で分けて取ると重複・取りこぼしが出る
    const order = "order by region, name, id";
    if (!limit) {
      const { rows } = await query<Spot>(
        `select * from spots where ${baseConditions.join(" and ")} ${order}`,
        params
      );
      return NextResponse.json({ data: rows });
    }
    const { rows } = await query<Spot>(
      `select * from spots where ${baseConditions.join(" and ")} ${order}
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limit, offset]
    );
    return NextResponse.json({ data: rows });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const conditions = [...baseConditions];
  const listParams = [...params];

  // 自分が非表示にしたスポット(spot_hides)は「シリーズから探す」のページング一覧に
  // 出さない(件数にも含めない)。解除は/[type]/spotsの「非表示にしたスポット」から。
  // 非ページングの全件取得(自分の非公開スポット・管理画面のCSV差分等)には適用しない
  conditions.push(
    "not exists (select 1 from spot_hides h where h.user_id = $1 and h.spot_id = spots.id)"
  );

  const search = searchParams.get("search");
  if (search) {
    listParams.push(`%${search}%`);
    const idx = listParams.length;
    conditions.push(
      `(name ilike $${idx} or name_kana ilike $${idx} or region ilike $${idx})`
    );
  }

  const series = searchParams.getAll("series");
  if (series.length > 0) {
    listParams.push(series);
    conditions.push(`series = any($${listParams.length}::text[])`);
  }

  // ランクの絞り込み。'none'(ランクなし)はnullとの比較になるので別の条件にする
  const rankParams = searchParams.getAll("rank");
  const ranks = rankParams.map(parseRank).filter((r): r is NonNullable<typeof r> => r !== null);
  const includeNoRank = rankParams.includes("none");
  if (rankParams.length > 0) {
    listParams.push(ranks);
    const idx = listParams.length;
    conditions.push(
      includeNoRank
        ? `(rank = any($${idx}::text[]) or rank is null)`
        : `rank = any($${idx}::text[])`
    );
  }

  // シリーズの並び順はこの種別のシリーズ設定(activeType.settings.series_styles。
  // 未設定なら定義なし)の並びをそのまま使う。lib/seriesStyle.tsのgetSeriesOrderと揃えること
  // (絞り込みなしで全件表示したときに、定義順の先頭のシリーズから並ぶように)
  const seriesOrder = resolveSeriesStyles(activeType).map((s) => s.series);

  const where = conditions.join(" and ");
  // 並びは「ランク順(A→E→なし) → シリーズの定義順 → 地域 → 名前」。
  // ランクは種別をまたいで同じ意味なのでSQL側でも決め打ちの順で並べる
  const orderParams = [...listParams, [...RANKS], seriesOrder];
  const rankOrderIdx = orderParams.length - 1;
  const seriesOrderIdx = orderParams.length;
  const [{ rows: items }, { rows: countRows }, { rows: seriesRows }] = await Promise.all([
    query<Spot>(
      `select * from spots where ${where}
       order by coalesce(array_position($${rankOrderIdx}::text[], rank), 999999),
                coalesce(array_position($${seriesOrderIdx}::text[], series), 999999), region, name
       limit $${seriesOrderIdx + 1} offset $${seriesOrderIdx + 2}`,
      [...orderParams, SPOTS_PAGE_SIZE, (page - 1) * SPOTS_PAGE_SIZE]
    ),
    query<{ count: string }>(`select count(*) from spots where ${where}`, listParams),
    // シリーズ選択肢は検索文字列・選択中シリーズの影響を受けず、種別全体から出す
    query<{ series: string }>(
      `select distinct series from spots where ${baseConditions.join(" and ")} and series is not null`,
      params
    ),
  ]);

  return NextResponse.json({
    data: {
      items,
      total: Number(countRows[0].count),
      availableSeries: seriesRows.map((r) => r.series),
    },
  });
}

interface SpotInput {
  /** 種別内で一意な省略可の参照キー(ルートCSVがスポットを指すのに使う) */
  key?: string | null;
  name: string;
  name_kana: string | null;
  lat: number;
  lng: number;
  region: string;
  /** A〜E。省略・null・A〜E以外は「ランクなし」として扱う(parseRankが寄せる) */
  rank?: string | null;
  series: string | null;
  /** 0個以上。省略・nullは「カテゴリなし」(空配列)として扱う */
  categories?: string[] | null;
  description: string | null;
  /** 登録経路。CSVインポート(AdminView)だけが'csv'を明示し、省略時は'manual' */
  origin?: string;
}

// unnest()で複数行を1回のINSERTにまとめる(CSVインポート等、大量件数の
// 逐次INSERTがラウンドトリップの積み重ねでタイムアウトするのを避けるため)。
// with ordinalityで元の並び順を保持し、そのままRETURNINGの順序に反映させる
async function insertSpots(
  spotTypeId: string,
  records: SpotInput[],
  statuses: string[],
  createdBy: string
) {
  // categoriesは1件ごとに要素数が異なるため、他の列のように text[] を横に並べる
  // unnestには載せられない(2次元配列は全行同じ長さである必要がある)。
  // 1件分を1つのJSON配列にまとめた jsonb[] として渡し、SQL側で text[] に開く
  const { rows } = await query<Spot>(
    `insert into spots
      (spot_type_id, key, name, name_kana, lat, lng, region, rank, series, categories, description, status, origin, created_by)
     select $1, u.key, u.name, u.name_kana, u.lat, u.lng, u.region, u.rank, u.series,
            array(select jsonb_array_elements_text(u.categories)), u.description, u.status, u.origin, $2
     from unnest($3::text[], $4::text[], $5::text[], $6::float8[], $7::float8[], $8::text[], $9::text[], $10::text[], $11::jsonb[], $12::text[], $13::text[], $14::text[])
       with ordinality as u(key, name, name_kana, lat, lng, region, rank, series, categories, description, status, origin, ord)
     order by u.ord
     returning *`,
    [
      spotTypeId,
      createdBy,
      records.map((r) => r.key ?? null),
      records.map((r) => r.name),
      records.map((r) => r.name_kana),
      records.map((r) => r.lat),
      records.map((r) => r.lng),
      records.map((r) => r.region),
      records.map((r) => parseRank(r.rank)),
      records.map((r) => r.series),
      records.map((r) => JSON.stringify(r.categories ?? [])),
      records.map((r) => r.description),
      statuses,
      records.map((r) => r.origin ?? "manual"),
    ]
  );
  return rows;
}

/**
 * 追加したスポットで**使われた値のうち、その種別の一覧にまだ無いものを一覧の末尾へ足す**
 * (`?register_series=1` / `?register_categories=1`のときだけ)。
 *
 * **一覧に既定値を置いていないぶん、使った値がそのまま一覧になっていく形が要る。**
 * 周辺を探すは地図データのジャンル(「ラーメン」「カフェ」…)をそのままシリーズにするので、
 * 足さないと**ピンが全部同じ見た目になり、何を追加したのか地図から読めない**
 * (シリーズはピンの中身と色を決める軸。`lib/spotStyle.ts`)。追加のたびに管理画面へ回って
 * 同じ語を打ち直させるのも筋が悪い。カテゴリは絞り込みの並びと次回の候補のために足す。
 *
 * **入口を限る。** 呼び出し側が明示したときだけ動かし、権限もspot_admin/adminに限る ——
 * CSVインポートのような大量投入まで一覧へ流し込むと、**空配列を明示して
 * 「定義なし」にしてある種別の意図を黙って上書きする**ことになる。
 *
 * **失敗しても呼び出しは成功のまま返す。** スポットはもう入っているので、
 * 一覧の更新に失敗したことでエラーを返すと「追加できなかった」と読めてしまう。
 */
async function registerUsedValues(
  spotType: SpotType,
  spots: Spot[],
  what: { series: boolean; categories: boolean }
) {
  const updates: [string, string][] = [];
  if (what.series) {
    const merged = mergeSeriesStyles(
      resolveSeriesStyles(spotType),
      spots.map((s) => s.series)
    );
    if (merged) updates.push([SERIES_STYLES_SETTING_KEY, JSON.stringify(merged)]);
  }
  if (what.categories) {
    const merged = mergeCategories(
      resolveCategories(spotType),
      spots.flatMap((s) => s.categories ?? [])
    );
    if (merged) updates.push([CATEGORIES_SETTING_KEY, JSON.stringify(merged)]);
  }
  for (const [key, value] of updates) {
    try {
      await query(
        `insert into spot_type_settings (spot_type_id, key, value)
         values ($1, $2, $3)
         on conflict (spot_type_id, key) do update set value = excluded.value`,
        [spotType.id, key, value]
      );
    } catch {
      // 一覧に載らないだけで、スポット自体のシリーズ・カテゴリは保存できている
    }
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 新規登録先のスポット種別も、参照(GET)と同じくURLのキーで必ず明示させる
  // (app_settingsの既定には依存しない)
  const { searchParams: postParams } = new URL(request.url);
  const typeKey = postParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const { rows: typeRows } = await query<SpotType>(
    `${SPOT_TYPE_SELECT} where t.key = $1`,
    [typeKey]
  );
  const spotType = typeRows[0];
  if (
    !spotType ||
    (!getSpotTypeSetting(spotType, "public_visible") && !SPOT_ADMIN_ROLES.includes(user.role))
  ) {
    return NextResponse.json({ error: "存在しない種別です。" }, { status: 404 });
  }

  // 一般ユーザーは非公開スポットのみ、モデレーターは非公開/承認待ち、管理者は
  // それに加えて公開も選べる(いずれも未指定なら user以外は承認待ち、userは非公開)
  const allowedStatuses = ALLOWED_STATUS_BY_ROLE[user.role];
  const defaultStatus = user.role === "user" ? "private" : "pending";

  const body = await request.json();
  const records: (SpotInput & { status?: string })[] = Array.isArray(body)
    ? body
    : [body];

  const statuses = records.map((r) => r.status ?? defaultStatus);
  const invalid = statuses.find(
    (s) => !(allowedStatuses as string[]).includes(s)
  );
  if (invalid) {
    return NextResponse.json(
      { error: `この権限では状態「${invalid}」を選べません。` },
      { status: 403 }
    );
  }

  // originはCSVインポート(spot_admin/admin限定の経路)だけが'csv'を明示できる。
  // それ以外は省略='manual'(手動追加)として記録する
  const invalidOrigin = records.find(
    (r) =>
      r.origin != null &&
      (r.origin !== "manual" &&
        (r.origin !== "csv" || !SPOT_ADMIN_ROLES.includes(user.role)))
  );
  if (invalidOrigin) {
    return NextResponse.json(
      { error: `origin「${invalidOrigin.origin}」は指定できません。` },
      { status: 403 }
    );
  }

  try {
    const inserted = await insertSpots(spotType.id, records, statuses, user.id);
    if (SPOT_ADMIN_ROLES.includes(user.role)) {
      const series = postParams.get("register_series") === "1";
      const categories = postParams.get("register_categories") === "1";
      if (series || categories) {
        await registerUsedValues(spotType, inserted, { series, categories });
      }
    }
    return NextResponse.json({ data: Array.isArray(body) ? inserted : inserted[0] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "insert failed" },
      { status: 400 }
    );
  }
}
