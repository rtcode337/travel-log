import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteExportZip } from "@/lib/exportStorage";

/**
 * エクスポートのジョブと、出来上がっているZIPを削除する(管理者のみ)。
 * 同じユーザーの新しいZIPが出来れば古いものは自動で消えるが、
 * 失敗したジョブや、コンテナが落ちて running のまま残った行を片付けるために要る。
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const { rows } = await query<{ file_path: string | null }>(
    "delete from export_jobs where id = $1 returning file_path",
    [id]
  );
  if (rows.length === 0) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (rows[0].file_path) await deleteExportZip(rows[0].file_path);

  return NextResponse.json({ data: { ok: true } });
}
