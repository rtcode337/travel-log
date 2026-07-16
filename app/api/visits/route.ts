import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { deleteVisitPhotos, saveVisitPhoto } from "@/lib/photos";
import type { Visit } from "@/lib/types";

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

  let rows: Visit[];
  try {
    ({ rows } = await query<Visit>(
      `insert into visits (user_id, spot_id, visited_on, date_precision, memo, photos)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [
        userId,
        body.spot_id,
        body.visited_on,
        body.date_precision,
        body.memo,
        photoPaths,
      ]
    ));
  } catch (e) {
    // DBに記録できなかった写真ファイルを残さない
    await deleteVisitPhotos(photoPaths);
    throw e;
  }

  // 訪問を記録したら、その場所は訪問予定リストから自動的に外す
  await query("delete from visit_plans where user_id = $1 and spot_id = $2", [
    userId,
    body.spot_id,
  ]);

  return NextResponse.json({ data: rows[0] });
}
