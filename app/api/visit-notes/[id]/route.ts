import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { deleteVisitPhotos, saveVisitPhoto } from "@/lib/photos";
import { MAX_PHOTOS_PER_VISIT } from "@/lib/visitPhoto";
import { PHOTOS_DISABLED_MESSAGE, photosEnabled } from "@/lib/features";
import type { VisitNote } from "@/lib/types";

export const maxDuration = 60;

/** 追記1件を本人のものに限って引く(所有者は元の訪問記録のuser_id) */
async function findOwnNote(id: string, userId: string) {
  const { rows } = await query<VisitNote>(
    `select n.id, n.visit_id, n.body, n.photos, n.created_at, n.updated_at
       from visit_notes n
       join visits v on v.id = n.visit_id
      where n.id = $1 and v.user_id = $2`,
    [id, userId]
  );
  return rows[0];
}

/**
 * 追記の編集。写真は訪問記録のPATCHと同じく「既存の相対パス=残す」「data URL=新規追加」の
 * 混在で受け取り、相対パスはその追記が現在持っているものに限定して検証する。
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const existing = await findOwnNote(id, userId);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await request.json();

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
  // 写真を畳んだ環境では**追加**(data URL)だけを拒む。既にある写真を残す・外すのは
  // そのまま通す(訪問記録のPATCHと同じ扱い)
  if (
    !photosEnabled &&
    (inputPhotos as string[]).some((p) => p.startsWith("data:"))
  ) {
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

  const existingPaths = new Set(existing.photos);
  const newPhotoPaths: string[] = []; // 今回保存したファイル(失敗時に消す)
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

  let rows: VisitNote[];
  try {
    ({ rows } = await query<VisitNote>(
      `update visit_notes set body = $1, photos = $2
        where id = $3
        returning id, visit_id, body, photos, created_at, updated_at`,
      [noteBody, photoPaths, id]
    ));
  } catch (e) {
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
  const existing = await findOwnNote(id, userId);
  if (!existing) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await query("delete from visit_notes where id = $1", [id]);
  await deleteVisitPhotos(existing.photos);
  return NextResponse.json({ data: { ok: true } });
}
