import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  ALLOWED_STATUS_BY_ROLE,
  MODERATION_ROLES,
  SPOT_ADMIN_ROLES,
  SPOTS_PAGE_SIZE,
  type Spot,
} from "@/lib/types";

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

  const { rows: typeRows } = await query<{ id: string; visibility: string }>(
    "select id, visibility from spot_types where key = $1",
    [typeKey]
  );
  const activeType = typeRows[0];
  // admin_only・disabledの種別はadmin/spot_admin以外には存在自体を見せない
  // (ページ側の404と揃える。管理画面が全statusのスポットを読むためadmin側は素通し)
  if (
    !activeType ||
    (activeType.visibility !== "public" && !SPOT_ADMIN_ROLES.includes(user.role))
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
  // 従来通り全件返す。ランクから探す画面(重い一覧)のみ検索・ランク絞り込み込みで
  // ページングする
  const pageParam = searchParams.get("page");
  if (!pageParam) {
    const { rows } = await query<Spot>(
      `select * from spots where ${baseConditions.join(" and ")} order by prefecture, name`,
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
      `(name ilike $${idx} or name_kana ilike $${idx} or prefecture ilike $${idx})`
    );
  }

  const rank = searchParams.get("rank");
  if (rank) {
    listParams.push(rank);
    conditions.push(`rank = $${listParams.length}`);
  }

  // ランクの並び順(A〜E→Z→郵便局→その他既知外→null)はlib/rankStyle.tsの
  // getRankOrderと揃えること(すべてランク表示時にランクが高い順になるように)
  const RANK_ORDER_SQL = `
    case
      when rank = 'A' then 0
      when rank = 'B' then 1
      when rank = 'C' then 2
      when rank = 'D' then 3
      when rank = 'E' then 4
      when rank = 'Z' then 5
      when rank = '郵便局' then 6
      when rank is null then 8
      else 7
    end`;

  const where = conditions.join(" and ");
  const [{ rows: items }, { rows: countRows }, { rows: rankRows }] = await Promise.all([
    query<Spot>(
      `select * from spots where ${where} order by ${RANK_ORDER_SQL}, prefecture, name
       limit $${listParams.length + 1} offset $${listParams.length + 2}`,
      [...listParams, SPOTS_PAGE_SIZE, (page - 1) * SPOTS_PAGE_SIZE]
    ),
    query<{ count: string }>(`select count(*) from spots where ${where}`, listParams),
    // ランク選択肢は検索文字列・選択中ランクの影響を受けず、種別全体から出す
    query<{ rank: string }>(
      `select distinct rank from spots where ${baseConditions.join(" and ")} and rank is not null`,
      params
    ),
  ]);

  return NextResponse.json({
    data: {
      items,
      total: Number(countRows[0].count),
      availableRanks: rankRows.map((r) => r.rank),
    },
  });
}

interface SpotInput {
  name: string;
  name_kana: string | null;
  prefecture: string;
  municipality: string | null;
  lat: number;
  lng: number;
  rank: string | null;
  category: string | null;
  description: string | null;
  official_url: string | null;
}

async function insertSpot(
  spotTypeId: string,
  spot: SpotInput,
  source: "manual" | "user_submitted",
  status: string,
  createdBy: string
) {
  const { rows } = await query<Spot>(
    `insert into spots
      (spot_type_id, name, name_kana, prefecture, municipality, lat, lng, rank, category, description, official_url, source, status, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     returning *`,
    [
      spotTypeId,
      spot.name,
      spot.name_kana,
      spot.prefecture,
      spot.municipality,
      spot.lat,
      spot.lng,
      spot.rank,
      spot.category,
      spot.description,
      spot.official_url,
      source,
      status,
      createdBy,
    ]
  );
  return rows[0];
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
  const { rows: typeRows } = await query<{ id: string; visibility: string }>(
    "select id, visibility from spot_types where key = $1",
    [typeKey]
  );
  const spotType = typeRows[0];
  if (
    !spotType ||
    (spotType.visibility !== "public" && !SPOT_ADMIN_ROLES.includes(user.role))
  ) {
    return NextResponse.json({ error: "存在しない種別です。" }, { status: 404 });
  }

  // 一般ユーザーは非公開スポットのみ、モデレーターは非公開/承認待ち、管理者は
  // それに加えて公開も選べる(いずれも未指定なら user以外は承認待ち、userは非公開)
  const allowedStatuses = ALLOWED_STATUS_BY_ROLE[user.role];
  const defaultStatus = user.role === "user" ? "private" : "pending";
  const source = SPOT_ADMIN_ROLES.includes(user.role) ? "manual" : "user_submitted";

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

  try {
    const inserted = [];
    for (let i = 0; i < records.length; i++) {
      inserted.push(
        await insertSpot(spotType.id, records[i], source, statuses[i], user.id)
      );
    }
    return NextResponse.json({ data: Array.isArray(body) ? inserted : inserted[0] });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "insert failed" },
      { status: 400 }
    );
  }
}
