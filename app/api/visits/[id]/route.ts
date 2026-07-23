import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { deleteVisitPhotos, saveVisitPhoto } from "@/lib/photos";
import type { Visit } from "@/lib/types";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  // 編集できるのは自分の訪問記録のみ。既存の写真パスの検証にも現在の行を使う
  const { rows: existingRows } = await query<Visit>(
    "select * from visits where id = $1 and user_id = $2",
    [id, userId]
  );
  const existing = existingRows[0];
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await request.json();

  // 写真は「既存の相対パス(残す写真)」と「data URL(追加する写真)」の混在で届く。
  // 相対パスはこの訪問記録が現在持っているものに限定する(他人の写真パスや
  // 別の訪問記録のパスを直接差し込ませない)
  const inputPhotos: unknown = body.photos ?? [];
  if (
    !Array.isArray(inputPhotos) ||
    inputPhotos.some((p) => typeof p !== "string")
  ) {
    return NextResponse.json({ error: "invalid photos" }, { status: 400 });
  }
  const MAX_PHOTOS_PER_VISIT = 10;
  if (inputPhotos.length > MAX_PHOTOS_PER_VISIT) {
    return NextResponse.json(
      { error: `写真は1件の訪問記録につき${MAX_PHOTOS_PER_VISIT}枚までです。` },
      { status: 400 }
    );
  }

  const existingPaths = new Set(existing.photos);
  const newPhotoPaths: string[] = []; // 今回のリクエストで新規保存したファイル(失敗時に消す)
  const photoPaths: string[] = [];
  try {
    for (const photo of inputPhotos as string[]) {
      if (photo.startsWith("data:")) {
        const saved = await saveVisitPhoto(userId, photo);
        newPhotoPaths.push(saved);
        photoPaths.push(saved);
      } else if (existingPaths.has(photo)) {
        photoPaths.push(photo);
      } else {
        throw new Error("unknown photo path");
      }
    }
  } catch {
    await deleteVisitPhotos(newPhotoPaths);
    return NextResponse.json(
      { error: "写真の保存に失敗しました。" },
      { status: 400 }
    );
  }

  let rows: Visit[];
  try {
    ({ rows } = await query<Visit>(
      `update visits set visited_on = $1, memo = $2, photos = $3
       where id = $4 and user_id = $5
       returning *`,
      [body.visited_on, body.memo, photoPaths, id, userId]
    ));
  } catch (e) {
    // DBに記録できなかった新規写真ファイルを残さない
    await deleteVisitPhotos(newPhotoPaths);
    throw e;
  }

  // 編集で外された写真のファイルを消す(DB更新が成功してから)
  const keptPaths = new Set(photoPaths);
  await deleteVisitPhotos(existing.photos.filter((p) => !keptPaths.has(p)));

  return NextResponse.json({ data: rows[0] });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const { rows } = await query<{ photos: string[] }>(
    "delete from visits where id = $1 and user_id = $2 returning photos",
    [id, userId]
  );
  await deleteVisitPhotos(rows.flatMap((r) => r.photos));
  return NextResponse.json({ ok: true });
}
