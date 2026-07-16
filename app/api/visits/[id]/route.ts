import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { deleteVisitPhotos } from "@/lib/photos";

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
