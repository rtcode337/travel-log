import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { deleteVisitPhotos, saveVisitPhoto } from "@/lib/photos";
import { MAX_PHOTOS_PER_VISIT } from "@/lib/visitPhoto";
import { PHOTOS_DISABLED_MESSAGE, photosEnabled } from "@/lib/features";
import type { VisitNote } from "@/lib/types";

// 写真つきの追記を1リクエストで捌くため、既定(10秒)では足りない
// (Vercelのサーバーレス関数の上限。指定の無いホストでは無視される)
export const maxDuration = 60;

/**
 * 訪問記録への追記(`visit_notes`)。所有者は元の訪問記録(`visits.user_id`)で
 * 決まるため、この表自体は user_id を持たず、読み書きのたびに visits と結合して
 * 本人のものだけに限る。
 *
 * **訪問記録(`GET /api/visits`)に相乗りさせない**のは、あちらが地図・一覧のために
 * 全件を読む口だから —— 追記の本文と写真パスまで載せると、スポット詳細でしか
 * 使わないデータを毎回全件ぶん運ぶことになる。こちらは `spot_id`(そのスポットの
 * 訪問記録ぶん全部)か `visit_id`(1件ぶん)で引く。
 */
export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const spotId = searchParams.get("spot_id");
  const visitId = searchParams.get("visit_id");
  if (!spotId && !visitId) {
    return NextResponse.json(
      { error: "spot_id または visit_id が必要です。" },
      { status: 400 }
    );
  }

  // 古い順(書いた順に読める)。表示もこの順で元の記録の下に積む
  const { rows } = await query<VisitNote>(
    `select n.id, n.visit_id, n.body, n.photos, n.created_at, n.updated_at
       from visit_notes n
       join visits v on v.id = n.visit_id
      where v.user_id = $1
        and ($2::uuid is null or v.spot_id = $2)
        and ($3::uuid is null or n.visit_id = $3)
      order by n.created_at asc`,
    [userId, spotId, visitId]
  );

  return NextResponse.json({ data: rows });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const visitId = typeof body?.visit_id === "string" ? body.visit_id : null;
  if (!visitId) {
    return NextResponse.json({ error: "visit_id は必須です。" }, { status: 400 });
  }

  // 自分の訪問記録にだけ追記できる(他人の記録は404扱いで存在も伏せる)
  const { rows: visitRows } = await query<{ id: string }>(
    "select id from visits where id = $1 and user_id = $2",
    [visitId, userId]
  );
  if (visitRows.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // 写真は訪問記録と同じくdata URLで届き、保存先の相対パスだけをDBへ入れる
  // (data URL以外は受け付けない。他人の写真パスを直接差し込ませないため)
  const inputPhotos: unknown = body.photos ?? [];
  if (
    !Array.isArray(inputPhotos) ||
    inputPhotos.some((p) => typeof p !== "string")
  ) {
    return NextResponse.json({ error: "invalid photos" }, { status: 400 });
  }
  if (inputPhotos.length > MAX_PHOTOS_PER_VISIT) {
    return NextResponse.json(
      { error: `写真は1件の追記につき${MAX_PHOTOS_PER_VISIT}枚までです。` },
      { status: 400 }
    );
  }
  if (!photosEnabled && inputPhotos.length > 0) {
    return NextResponse.json({ error: PHOTOS_DISABLED_MESSAGE }, { status: 503 });
  }

  const noteBody =
    typeof body?.body === "string" && body.body.trim() ? body.body.trim() : null;
  if (!noteBody && inputPhotos.length === 0) {
    return NextResponse.json(
      { error: "本文か写真のどちらかを入れてください。" },
      { status: 400 }
    );
  }

  const photoPaths: string[] = [];
  try {
    for (const dataUrl of inputPhotos as string[]) {
      photoPaths.push(await saveVisitPhoto(userId, dataUrl));
    }
  } catch {
    await deleteVisitPhotos(photoPaths);
    return NextResponse.json(
      { error: "写真の保存に失敗しました。" },
      { status: 400 }
    );
  }

  let rows: VisitNote[];
  try {
    ({ rows } = await query<VisitNote>(
      `insert into visit_notes (visit_id, body, photos)
       values ($1, $2, $3)
       returning id, visit_id, body, photos, created_at, updated_at`,
      [visitId, noteBody, photoPaths]
    ));
  } catch (e) {
    // DBに記録できなかった写真ファイルを残さない
    await deleteVisitPhotos(photoPaths);
    throw e;
  }

  // **訪問回数は増やさない**。訪問予定・訪問予定リストの訪問済みにも触らない
  // —— 追記は「同じ1回の訪問に書き足す」操作で、新しい訪問ではないため
  return NextResponse.json({ data: rows[0] });
}
