import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { deleteVisitPhotos, saveVisitPhoto } from "@/lib/photos";
import { MAX_PHOTOS_PER_VISIT } from "@/lib/visitPhoto";
import { PHOTOS_DISABLED_MESSAGE, photosEnabled } from "@/lib/features";
import type { Visit } from "@/lib/types";

// 大量のスポット・写真を1リクエストで捌くため、既定(10秒)では足りない
// (Vercelのサーバーレス関数の上限。指定の無いホストでは無視される)
export const maxDuration = 60;

export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const spotId = searchParams.get("spot_id");

  const { rows } = spotId
    ? await query<Visit>(
        `select * from visits where user_id = $1 and spot_id = $2
         order by visited_on desc nulls last`,
        [userId, spotId]
      )
    : await query<Visit>("select * from visits where user_id = $1", [userId]);

  return NextResponse.json({ data: rows });
}

export async function POST(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await request.json();

  // 写真はブラウザで縮小・圧縮済みのdata URLで届く。DBにはBase64を入れず、
  // photosフォルダへ保存した相対パスだけを保存する(lib/photos.ts参照)。
  // data URL以外は受け付けない(他人の写真パス等を直接差し込ませない)
  const inputPhotos: unknown = body.photos ?? [];
  if (
    !Array.isArray(inputPhotos) ||
    inputPhotos.some((p) => typeof p !== "string")
  ) {
    return NextResponse.json({ error: "invalid photos" }, { status: 400 });
  }
  // ブラウザを経由しない直接APIコールで大量の写真を送りつけるディスク圧迫を防ぐ
  if (inputPhotos.length > MAX_PHOTOS_PER_VISIT) {
    return NextResponse.json(
      { error: `写真は1件の訪問記録につき${MAX_PHOTOS_PER_VISIT}枚までです。` },
      { status: 400 }
    );
  }
  // 写真を畳んだ環境では新しい写真を受け取らない(画面側でも入力欄を出さないが、
  // APIを直接叩けば通ってしまうため両方で塞ぐ。lib/features.ts)
  if (!photosEnabled && inputPhotos.length > 0) {
    return NextResponse.json(
      { error: PHOTOS_DISABLED_MESSAGE },
      { status: 503 }
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

  // unvisited=trueは「未訪問記録」(訪問済みには数えない記録)。省略時は通常の訪問記録
  const unvisited = body.unvisited === true;

  let rows: Visit[];
  try {
    ({ rows } = await query<Visit>(
      `insert into visits (user_id, spot_id, visited_on, memo, photos, unvisited)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [userId, body.spot_id, body.visited_on, body.memo, photoPaths, unvisited]
    ));
  } catch (e) {
    // DBに記録できなかった写真ファイルを残さない
    await deleteVisitPhotos(photoPaths);
    throw e;
  }

  // 訪問を記録したら、その場所は訪問予定(行きたい場所のブックマーク)から
  // 自動的に外す。ただし日時なしの未訪問記録(=まだ行っていない下調べのメモ)は
  // 行きたい場所のままなので外さない(日時ありの未訪問記録は「訪れたが改めて
  // 来たい」記録のため、通常の訪問と同じく外す)
  if (!(unvisited && !body.visited_on)) {
    await query("delete from visit_plans where user_id = $1 and spot_id = $2", [
      userId,
      body.spot_id,
    ]);
    // 訪問予定リスト(旅程)側は行を消さず、訪問済みの印を付けるだけにする。
    // 消してしまうと「その旅程で何を回ったか」が後から辿れなくなるため。
    // 経路(地図の紫の矢印・Google マップの経路検索)からはこの印で外れる。
    // 本人の全リストが対象で、既に印が付いている行は日時を上書きしない
    // (最初にそこへ行った時刻を残す)
    await query(
      `update visit_plan_list_items it
          set visited_at = now()
         from visit_plan_lists l
        where it.list_id = l.id
          and l.user_id = $1
          and it.spot_id = $2
          and it.visited_at is null`,
      [userId, body.spot_id]
    );
  }

  return NextResponse.json({ data: rows[0] });
}
