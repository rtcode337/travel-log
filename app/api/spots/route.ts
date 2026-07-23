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
import { resolveSeriesStyles } from "@/lib/seriesStyle";

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
    const { rows } = await query<Spot>(
      `select * from spots where ${baseConditions.join(" and ")} order by region, name`,
      params
    );
    return NextResponse.json({ data: rows });
  }

  const page = Math.max(1, Number(pageParam) || 1);
  const conditions = [...baseConditions];
  const listParams = [...params];

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

  // シリーズの並び順はこの種別のシリーズ設定(activeType.settings.series_styles、無ければ
  // 観光地のA〜E)の並びをそのまま使う。lib/seriesStyle.tsのgetSeriesOrderと揃えること
  // (絞り込みなしで全件表示したときに、定義順の先頭のシリーズから並ぶように)
  const seriesOrder = resolveSeriesStyles(activeType).map((s) => s.series);

  const where = conditions.join(" and ");
  const seriesOrderParams = [...listParams, seriesOrder];
  const seriesOrderIdx = seriesOrderParams.length;
  const [{ rows: items }, { rows: countRows }, { rows: seriesRows }] = await Promise.all([
    query<Spot>(
      `select * from spots where ${where}
       order by coalesce(array_position($${seriesOrderIdx}::text[], series), 999999), region, name
       limit $${seriesOrderIdx + 1} offset $${seriesOrderIdx + 2}`,
      [...seriesOrderParams, SPOTS_PAGE_SIZE, (page - 1) * SPOTS_PAGE_SIZE]
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
      (spot_type_id, key, name, name_kana, lat, lng, region, series, categories, description, status, origin, created_by)
     select $1, u.key, u.name, u.name_kana, u.lat, u.lng, u.region, u.series,
            array(select jsonb_array_elements_text(u.categories)), u.description, u.status, u.origin, $2
     from unnest($3::text[], $4::text[], $5::text[], $6::float8[], $7::float8[], $8::text[], $9::text[], $10::jsonb[], $11::text[], $12::text[], $13::text[])
       with ordinality as u(key, name, name_kana, lat, lng, region, series, categories, description, status, origin, ord)
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
      records.map((r) => r.series),
      records.map((r) => JSON.stringify(r.categories ?? [])),
      records.map((r) => r.description),
      statuses,
      records.map((r) => r.origin ?? "manual"),
    ]
  );
  return rows;
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 新規登録先のスポット種別も、参照(GET)と同じくURLのキーで必ず明示させる
  // (app_settingsの既定には依存しない)
  const typeKey = new URL(request.url).searchParams.get("type");
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
    return NextResponse.json({ data: Array.isArray(body) ? inserted : inserted[0] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "insert failed" },
      { status: 400 }
    );
  }
}
