import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  ALLOWED_STATUS_BY_ROLE,
  getSpotTypeSetting,
  MODERATION_ROLES,
  SPOT_ADMIN_ROLES,
  type Role,
  type SpotRoute,
  type SpotType,
} from "@/lib/types";
import { SPOT_TYPE_SELECT } from "@/lib/spot-types-query";

/** GET/POST共通: typeクエリの種別を解決し、種別の閲覧権限もここで確認する */
async function resolveType(request: Request, user: { role: Role }) {
  const typeKey = new URL(request.url).searchParams.get("type");
  if (!typeKey) {
    return { error: NextResponse.json({ error: "type is required" }, { status: 400 }) };
  }
  const { rows } = await query<SpotType>(`${SPOT_TYPE_SELECT} where t.key = $1`, [
    typeKey,
  ]);
  const spotType = rows[0];
  if (
    !spotType ||
    (!getSpotTypeSetting(spotType, "public_visible") &&
      !SPOT_ADMIN_ROLES.includes(user.role))
  ) {
    return { error: NextResponse.json({ error: "存在しない種別です。" }, { status: 404 }) };
  }
  return { spotType };
}

/**
 * 種別のルート一覧(経由地込み)。ルート自体の閲覧権限はスポットと同じ
 * (公開=全員、非公開=作成者本人のみ、承認待ち・却下=本人+moderator以上)。
 * 経由地もスポットの閲覧権限に合わせて「公開スポット、または自分が追加した
 * スポット」の分だけ返す(他人の非公開スポットがルートに入っていても、
 * その点は座標ごと見えない)
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const resolved = await resolveType(request, user);
  if (resolved.error) return resolved.error;

  const { rows } = await query<SpotRoute>(
    `select r.id, r.spot_type_id, r.name, r.series, r.description,
       r.status, r.created_by, r.created_at, r.updated_at,
       coalesce(
         (select json_agg(json_build_object(
             'spot_id', p.spot_id, 'seq', p.seq,
             'lat', s.lat, 'lng', s.lng, 'spot_name', s.name,
             'description', p.description
           ) order by p.seq)
          from spot_route_points p
          join spots s on s.id = p.spot_id
          where p.route_id = r.id
            and (s.status = 'published' or s.created_by = $2)),
         '[]'::json
       ) as points
     from spot_routes r
     where r.spot_type_id = $1
       and (r.status = 'published'
            or r.created_by = $2
            or (r.status in ('pending', 'rejected') and $3))
     order by r.created_at, r.name`,
    [
      resolved.spotType.id,
      user.id,
      MODERATION_ROLES.includes(user.role),
    ]
  );
  return NextResponse.json({ data: rows });
}

interface RouteInput {
  name: string;
  /** このルートが属するシリーズ。省略・nullなら既定色のルートになる */
  series?: string | null;
  /** ルート全体の説明文。省略・nullなら説明なし */
  description?: string | null;
  /** spotsと同じ公開状態。ALLOWED_STATUS_BY_ROLEの範囲で指定でき、省略時はpending */
  status?: string;
  /** 経由地(巡る順)。descriptionはその経由地から次の経由地への区間の説明 */
  points: { spot_id: string; description?: string | null }[];
}

/**
 * ルートの一括upsert(CSVインポート用)。ルート名ごとに、経由地を送られてきた
 * 並びで丸ごと置き換える(部分更新はしない)。含まれないルートには触らない。
 * スポットデータのCSVインポートと同じくspot_admin/adminのみ
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!SPOT_ADMIN_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }
  const resolved = await resolveType(request, user);
  if (resolved.error) return resolved.error;
  const spotTypeId = resolved.spotType.id;

  const body = await request.json();
  const routes: RouteInput[] = Array.isArray(body?.routes) ? body.routes : [];
  // statusの扱いはスポットの新規登録と同じ(role別の許可リスト、未指定はpending。
  // このAPI自体がspot_admin/admin限定のため、実質publishedも選べる)
  const allowedStatuses = ALLOWED_STATUS_BY_ROLE[user.role];
  for (const route of routes) {
    if (
      typeof route?.name !== "string" ||
      !route.name.trim() ||
      (route.series != null && typeof route.series !== "string") ||
      (route.description != null && typeof route.description !== "string") ||
      !Array.isArray(route.points) ||
      route.points.length < 2 ||
      !route.points.every(
        (p) =>
          typeof p?.spot_id === "string" &&
          (p.description == null || typeof p.description === "string")
      )
    ) {
      return NextResponse.json(
        { error: "各経路には name と2件以上の points が必要です。" },
        { status: 400 }
      );
    }
    if (
      route.status != null &&
      !(allowedStatuses as string[]).includes(route.status)
    ) {
      return NextResponse.json(
        { error: `この権限では状態「${route.status}」を選べません。` },
        { status: 403 }
      );
    }
  }
  if (routes.length === 0) {
    return NextResponse.json({ error: "routes が空です。" }, { status: 400 });
  }

  // 経由地が全てこの種別のスポットであることを確認する(他種別への紐付けを防ぐ)
  const allSpotIds = Array.from(
    new Set(routes.flatMap((r) => r.points.map((p) => p.spot_id)))
  );
  const { rows: validRows } = await query<{ id: string }>(
    "select id from spots where spot_type_id = $1 and id = any($2::uuid[])",
    [spotTypeId, allSpotIds]
  );
  if (validRows.length !== allSpotIds.length) {
    return NextResponse.json(
      { error: "この種別に存在しないスポットが経路に含まれています。" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const route of routes) {
      const name = route.name.trim();
      const series = route.series?.trim() || null;
      const description = route.description?.trim() || null;
      const status = route.status ?? "pending";
      // 既存ルートの上書き時、created_byは最初の作成者のまま維持する
      const { rows } = await client.query<{ id: string }>(
        `insert into spot_routes (spot_type_id, name, series, description, status, created_by)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (spot_type_id, name)
           do update set series = excluded.series,
                         description = excluded.description,
                         status = excluded.status
         returning id`,
        [spotTypeId, name, series, description, status, user.id]
      );
      const routeId = rows[0].id;
      await client.query("delete from spot_route_points where route_id = $1", [
        routeId,
      ]);
      await client.query(
        `insert into spot_route_points (route_id, seq, spot_id, description)
         select $1, u.ord, u.spot_id, u.description
         from unnest($2::uuid[], $3::text[]) with ordinality as u(spot_id, description, ord)`,
        [
          routeId,
          route.points.map((p) => p.spot_id),
          route.points.map((p) => p.description?.trim() || null),
        ]
      );
    }
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "insert failed" },
      { status: 400 }
    );
  } finally {
    client.release();
  }

  return NextResponse.json({ data: { updatedCount: routes.length } });
}
