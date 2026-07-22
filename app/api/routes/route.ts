import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  getSpotTypeSetting,
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
 * 種別のルート一覧(経由地込み)。経由地はスポットの閲覧権限に合わせて
 * 「公開スポット、または自分が追加したスポット」の分だけ返す(他人の非公開
 * スポットがルートに入っていても、その点は座標ごと見えない)
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const resolved = await resolveType(request, user);
  if (resolved.error) return resolved.error;

  const { rows } = await query<SpotRoute>(
    `select r.id, r.spot_type_id, r.name, r.created_at,
       coalesce(
         (select json_agg(json_build_object(
             'spot_id', p.spot_id, 'seq', p.seq,
             'lat', s.lat, 'lng', s.lng, 'spot_name', s.name
           ) order by p.seq)
          from spot_route_points p
          join spots s on s.id = p.spot_id
          where p.route_id = r.id
            and (s.status = 'published' or s.created_by = $2)),
         '[]'::json
       ) as points
     from spot_routes r
     where r.spot_type_id = $1
     order by r.created_at, r.name`,
    [resolved.spotType.id, user.id]
  );
  return NextResponse.json({ data: rows });
}

interface RouteInput {
  name: string;
  spot_ids: string[];
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
  for (const route of routes) {
    if (
      typeof route?.name !== "string" ||
      !route.name.trim() ||
      !Array.isArray(route.spot_ids) ||
      route.spot_ids.length < 2 ||
      !route.spot_ids.every((id) => typeof id === "string")
    ) {
      return NextResponse.json(
        { error: "各ルートには name と2件以上の spot_ids が必要です。" },
        { status: 400 }
      );
    }
  }
  if (routes.length === 0) {
    return NextResponse.json({ error: "routes が空です。" }, { status: 400 });
  }

  // 経由地が全てこの種別のスポットであることを確認する(他種別への紐付けを防ぐ)
  const allSpotIds = Array.from(new Set(routes.flatMap((r) => r.spot_ids)));
  const { rows: validRows } = await query<{ id: string }>(
    "select id from spots where spot_type_id = $1 and id = any($2::uuid[])",
    [spotTypeId, allSpotIds]
  );
  if (validRows.length !== allSpotIds.length) {
    return NextResponse.json(
      { error: "この種別に存在しないスポットがルートに含まれています。" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const route of routes) {
      const name = route.name.trim();
      const { rows } = await client.query<{ id: string }>(
        `insert into spot_routes (spot_type_id, name) values ($1, $2)
         on conflict (spot_type_id, name) do update set name = excluded.name
         returning id`,
        [spotTypeId, name]
      );
      const routeId = rows[0].id;
      await client.query("delete from spot_route_points where route_id = $1", [
        routeId,
      ]);
      await client.query(
        `insert into spot_route_points (route_id, seq, spot_id)
         select $1, u.ord, u.spot_id
         from unnest($2::uuid[]) with ordinality as u(spot_id, ord)`,
        [routeId, route.spot_ids]
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
