import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_ADMIN_ROLES, type FlaggedSpot, type SpotFlag, type SpotType } from "@/lib/types";
import { SPOT_TYPE_SELECT } from "@/lib/spot-types-query";

/**
 * 修正・追加の依頼(spot_flags)。
 *
 * - 修正の依頼: 既にある公開スポットに付ける(spot_id)
 * - 追加の依頼: スポットの無い場所に付ける(座標と種別。spot_idは空)
 *
 * 付けるのも見るのもspot_admin/adminだけ。**印はスポットに何の影響も与えない** ——
 * 地図の見え方も公開状態も変わらず、管理画面の一覧に出るだけ。直すかどうかは
 * 受け取った側(収集を回す側・travel-log-dataのCSV)で決める。
 */

/**
 * 一覧の1行を組むSELECT。**追加の依頼は指す先のスポットが無い**ので、
 * スポットは left join で引き、座標は依頼そのもののものに落とす
 */
const FLAG_SELECT = `select f.id, f.spot_id, f.reason, f.flagged_by, f.forwarded_at, f.created_at,
       case when f.spot_id is null then 'add' else 'fix' end as kind,
       coalesce(s.name, '') as name, s.key, coalesce(s.region, '') as region,
       coalesce(s.lat, f.lat) as lat, coalesce(s.lng, f.lng) as lng,
       coalesce(nullif(u.nickname, ''), u.email) as flagged_by_name
  from spot_flags f
  left join spots s on s.id = f.spot_id
  left join users u on u.id = f.flagged_by`;

/** 種別キーから種別を引く。無ければnull(呼び出し側が404を返す) */
async function findSpotType(typeKey: string): Promise<SpotType | null> {
  const { rows } = await query<SpotType>(`${SPOT_TYPE_SELECT} where t.key = $1`, [
    typeKey,
  ]);
  return rows[0] ?? null;
}

/**
 * 種別の依頼の一覧(管理画面の「修正・追加の依頼」)。未依頼を先に、それぞれ
 * 依頼された順に並べる(まだ渡していないものが上に固まるほうが、渡す作業がしやすい)。
 * `mine=1` を付けると自分が出した依頼(修正・追加の両方)だけを返す(地図に印を出すため)
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!SPOT_ADMIN_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  // spot_id 指定は1件だけの問い合わせ(スポット詳細が依頼の有無を見るのに使う)
  const spotId = searchParams.get("spot_id");
  if (spotId) {
    const { rows } = await query<FlaggedSpot>(`${FLAG_SELECT} where f.spot_id = $1`, [
      spotId,
    ]);
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

  if (searchParams.get("mine") === "1") {
    const { rows } = await query<FlaggedSpot>(
      `${FLAG_SELECT}
        where coalesce(s.spot_type_id, f.spot_type_id) = $1 and f.flagged_by = $2
        order by f.created_at`,
      [spotType.id, user.id]
    );
    return NextResponse.json({ data: rows });
  }

  const { rows } = await query<FlaggedSpot>(
    `${FLAG_SELECT}
      where coalesce(s.spot_type_id, f.spot_type_id) = $1
      order by f.forwarded_at is not null, f.created_at`,
    [spotType.id]
  );
  return NextResponse.json({ data: rows });
}

/**
 * 依頼を「渡した(対応中)」にする・「未依頼」に戻す。
 * `{ ids: string[], forwarded: boolean }` を受け取る。**idで指す** —— 一覧を
 * テキストにしてから印を付けるまでの間に増えた依頼まで、渡したことにしないため。
 * 既に渡した日時が入っているものは上書きしない(最初に渡した日時を残す)。
 * 更新した件数を返す
 */
export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!SPOT_ADMIN_ROLES.includes(user.role)) {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const ids = body?.ids;
  const forwarded = body?.forwarded;
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    !ids.every((id) => typeof id === "string") ||
    typeof forwarded !== "boolean"
  ) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { rowCount } = await query(
    forwarded
      ? "update spot_flags set forwarded_at = now() where id = any($1::uuid[]) and forwarded_at is null"
      : "update spot_flags set forwarded_at = null where id = any($1::uuid[])",
    [ids]
  );
  return NextResponse.json({ data: { updated: rowCount ?? 0 } });
}

/**
 * 依頼する。`spot_id` を渡せば修正の依頼、`type`・`lat`・`lng` を渡せば追加の依頼。
 *
 * 修正の依頼は同じスポットに2度出しても1件のままで、理由だけが上書きされる
 * (トグルUIの二重送信に強くする。spot_hidesのPOSTと同じ考え方)。
 * 出し直すと未依頼に戻す —— 理由が変わったなら、渡した中身とはもう別の依頼なので。
 * **公開スポットだけが対象** —— 承認待ち・却下・非公開は承認/却下の流れで扱うため。
 * 追加の依頼は場所ごとに別の依頼として増える(同じ場所に2つ足りないこともある)。
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

  if (spotId === undefined || spotId === null) {
    return requestAdd(body, reason, user.id);
  }
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
       do update set reason = excluded.reason, flagged_by = excluded.flagged_by,
                     forwarded_at = null
     returning id, spot_id, reason, flagged_by, forwarded_at, created_at`,
    [spotId, reason, user.id]
  );
  return NextResponse.json({ data: rows[0] });
}

/** 追加の依頼(地図の右クリック「ここにスポット追加を依頼」)を1件足す */
async function requestAdd(
  body: { type?: unknown; lat?: unknown; lng?: unknown } | null,
  reason: string,
  userId: string
) {
  const typeKey = body?.type;
  const lat = body?.lat;
  const lng = body?.lng;
  if (
    typeof typeKey !== "string" ||
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    Math.abs(lat) > 90 ||
    Math.abs(lng) > 180
  ) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  const spotType = await findSpotType(typeKey);
  if (!spotType) {
    return NextResponse.json({ error: "存在しない種別です。" }, { status: 404 });
  }

  const { rows } = await query<SpotFlag>(
    `insert into spot_flags (spot_type_id, lat, lng, reason, flagged_by)
     values ($1, $2, $3, $4, $5)
     returning id, spot_id, reason, flagged_by, forwarded_at, created_at`,
    [spotType.id, lat, lng, reason, userId]
  );
  return NextResponse.json({ data: rows[0] });
}

/** 種別ぶんの依頼をまとめて取り消す(管理画面の一括取り消し)。消した件数を返す */
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

  // 修正の依頼はスポットの種別で、追加の依頼は依頼そのものの種別で数える
  const { rowCount } = await query(
    `delete from spot_flags f
      where f.spot_type_id = $1
         or f.spot_id in (select id from spots where spot_type_id = $1)`,
    [spotType.id]
  );
  return NextResponse.json({ data: { deleted: rowCount ?? 0 } });
}
