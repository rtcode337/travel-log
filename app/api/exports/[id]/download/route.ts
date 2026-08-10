import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { readExportZip } from "@/lib/exportStorage";

/**
 * 出来上がったエクスポートZIPをダウンロードする。
 * **落とせるのは管理者と、そのZIPの対象ユーザー本人だけ**(中身は本人の訪問記録と
 * 写真そのもの)。写真の配信(app/api/photos/[...path])と同じく、URLを知っていても
 * 他人のものは落とせない。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const { rows } = await query<{
    user_id: string;
    user_email: string;
    status: string;
    file_path: string | null;
    finished_at: Date | null;
  }>(
    `select j.user_id, u.email as user_email, j.status, j.file_path, j.finished_at
       from export_jobs j join users u on u.id = j.user_id
      where j.id = $1`,
    [id]
  );
  const job = rows[0];
  // 権限が無い場合も404にする(他人のジョブの存在自体を伏せる)
  if (!job || (user.role !== "admin" && job.user_id !== user.id)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (job.status !== "done" || !job.file_path) {
    return NextResponse.json({ error: "not ready" }, { status: 409 });
  }

  const data = await readExportZip(job.file_path);
  if (!data) {
    return NextResponse.json({ error: "file not found" }, { status: 410 });
  }

  // ファイル名はJSTの日付+メールアドレスのローカル部(誰のものか開く前に分かるように。
  // ASCII以外・記号はファイル名に使えない環境があるため英数字だけに落とす)
  const localPart = job.user_email.split("@")[0].replace(/[^A-Za-z0-9._-]/g, "");
  const jstDate = new Date((job.finished_at ?? new Date()).getTime() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
  const filename = `travel-log-visits-${localPart || "user"}-${jstDate}.zip`;

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
