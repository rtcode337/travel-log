import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_ADMIN_ROLES, type FlaggedSpot, type SpotFlag, type SpotType } from "@/lib/types";
import { SPOT_TYPE_SELECT } from "@/lib/spot-types-query";

/**
 * 公開スポットへの「間違い報告」(spot_flags)。
 *
 * 付けるのも見るのもspot_admin/adminだけ。**印はスポットに何の影響も与えない** ——
 * 地図の見え方も公開状態も変わらず、管理画面の一覧に出るだけ。直すかどうかは
 * travel-log-data側の作業(AIに投げる・CSVを直す)で決める。
 */

/** 種別キーから種別を引く。無ければnull(呼び出し側が404を返す) */
async function findSpotType(typeKey: string): Promise<SpotType | null> {
  const { rows } = await query<SpotType>(`${SPOT_TYPE_SELECT} where t.key = $1`, [
    typeKey,
  ]);
  return rows[0] ?? null;
}

/** 種別の報告の一覧(管理画面の「間違い報告のあったスポット」)。報告された順に並べる */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!SPOT_ADMIN_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  // spot_id 指定は1件だけの問い合わせ(スポット詳細が報告の有無を見るのに使う)
  const spotId = searchParams.get("spot_id");
  if (spotId) {
    const { rows } = await query<FlaggedSpot>(
      `select f.id, f.spot_id, f.reason, f.flagged_by, f.created_at,
              s.name, s.key, s.region, s.lat, s.lng,
              coalesce(nullif(u.nickname, ''), u.email) as flagged_by_name
         from spot_flags f
         join spots s on s.id = f.spot_id
         left join users u on u.id = f.flagged_by
        where f.spot_id = $1`,
      [spotId]
    );
    return NextResponse.json({ data: rows });
  }

  const typeKey = searchParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const spotType = await findSpotType(typeKey);
  if (!spotType) {
    return NextResponse.json({ error: "存在しない種別です。" }, { status: 404 });
  }

  const { rows } = await query<FlaggedSpot>(
    `select f.id, f.spot_id, f.reason, f.flagged_by, f.created_at,
            s.name, s.key, s.region, s.lat, s.lng,
            coalesce(nullif(u.nickname, ''), u.email) as flagged_by_name
       from spot_flags f
       join spots s on s.id = f.spot_id
       left join users u on u.id = f.flagged_by
      where s.spot_type_id = $1
      order by f.created_at`,
    [spotType.id]
  );
  return NextResponse.json({ data: rows });
}

/**
 * 報告する。同じスポットに2度報告しても1件のままで、理由だけが上書きされる
 * (トグルUIの二重送信に強くする。spot_hidesのPOSTと同じ考え方)。
 * **公開スポットだけが対象** —— 承認待ち・却下・非公開は承認/却下の流れで扱うため。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!SPOT_ADMIN_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const spotId = body?.spot_id;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (typeof spotId !== "string") {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { rows: spotRows } = await query<{ status: string }>(
    "select status from spots where id = $1",
    [spotId]
  );
  const spot = spotRows[0];
  if (!spot) {
    return NextResponse.json({ error: "存在しないスポットです。" }, { status: 404 });
  }
  if (spot.status !== "published") {
    return NextResponse.json(
      { error: "公開スポットにだけ付けられます。" },
      { status: 400 }
    );
  }

  const { rows } = await query<SpotFlag>(
    `insert into spot_flags (spot_id, reason, flagged_by)
     values ($1, $2, $3)
     on conflict (spot_id)
       do update set reason = excluded.reason, flagged_by = excluded.flagged_by
     returning id, spot_id, reason, flagged_by, created_at`,
    [spotId, reason, user.id]
  );
  return NextResponse.json({ data: rows[0] });
}

/** 種別ぶんの報告をまとめて取り消す(管理画面の一括取り消し)。消した件数を返す */
export async function DELETE(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!SPOT_ADMIN_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const typeKey = new URL(request.url).searchParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  const spotType = await findSpotType(typeKey);
  if (!spotType) {
    return NextResponse.json({ error: "存在しない種別です。" }, { status: 404 });
  }

  const { rowCount } = await query(
    `delete from spot_flags f
      using spots s
      where s.id = f.spot_id and s.spot_type_id = $1`,
    [spotType.id]
  );
  return NextResponse.json({ data: { deleted: rowCount ?? 0 } });
}
