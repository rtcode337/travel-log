import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { buildVisitExportZip } from "@/lib/visitExport";
import { deleteExportZip, saveExportZip } from "@/lib/exportStorage";
import {
  EXPORTS_DISABLED_MESSAGE,
  exportsEnabled,
} from "@/lib/features";
import type { ExportJob } from "@/lib/types";

/** 一覧・作成の返却に使う共通のSELECT(対象ユーザーのメールアドレスも返す) */
const JOB_SELECT = `
  select j.id, j.user_id, u.email as user_email, j.requested_by,
         j.status, j.file_size::float8 as file_size, j.visit_count, j.photo_count, j.error,
         j.created_at, j.finished_at
    from export_jobs j
    join users u on u.id = j.user_id`;

/**
 * 訪問記録エクスポートのジョブ一覧。
 * **管理者は全件、それ以外は自分が対象のものだけ**(アカウント画面で
 * 自分のZIPをダウンロードするため)。ファイルの実パスは返さない。
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!exportsEnabled) {
    return NextResponse.json(
      { error: EXPORTS_DISABLED_MESSAGE },
      { status: 503 }
    );
  }

  const { rows } =
    user.role === "admin"
      ? await query<ExportJob>(`${JOB_SELECT} order by j.created_at desc`)
      : await query<ExportJob>(
          `${JOB_SELECT} where j.user_id = $1 order by j.created_at desc`,
          [user.id]
        );

  // 生成状況を見に来る口なので、経路上のどこにもキャッシュさせない
  // (クライアント側もタブ内キャッシュを使わずに取りに来る。lib/api-client.ts)
  return NextResponse.json(
    { data: rows },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * 対象ユーザーのメールアドレスを指定してエクスポートを開始する(管理者のみ)。
 *
 * **ZIPの生成はリクエストの外で走らせ、すぐに running のジョブを返す** ——
 * 写真ごとまとめるため件数によっては数十秒以上かかり、待たせるとブラウザ側が
 * 先にタイムアウトするため。完了・失敗はジョブの status に書き戻す。
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (!exportsEnabled) {
    return NextResponse.json(
      { error: EXPORTS_DISABLED_MESSAGE },
      { status: 503 }
    );
  }
  // 他人の訪問記録と写真がまるごと入るため、管理者だけに限る
  // (spot_admin・moderatorはスポットの管理権限であって、記録を見る権限ではない)
  if (user.role !== "admin") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email) {
    return NextResponse.json(
      { error: "メールアドレスを入力してください。" },
      { status: 400 }
    );
  }

  const { rows: targets } = await query<{ id: string }>(
    "select id from users where lower(email) = lower($1)",
    [email]
  );
  const targetId = targets[0]?.id;
  if (!targetId) {
    return NextResponse.json(
      { error: `「${email}」のユーザーが見つかりません。` },
      { status: 404 }
    );
  }

  // 同じユーザーの生成が二重に走らないようにする(片方の結果が捨てられるだけで
  // 害は無いが、重い処理を無駄に並べない)
  const { rows: running } = await query(
    "select 1 from export_jobs where user_id = $1 and status = 'running'",
    [targetId]
  );
  if (running.length > 0) {
    return NextResponse.json(
      { error: "このユーザーのエクスポートは実行中です。" },
      { status: 409 }
    );
  }

  const { rows: created } = await query<{ id: string }>(
    `insert into export_jobs (user_id, requested_by, status)
     values ($1, $2, 'running')
     returning id`,
    [targetId, user.id]
  );
  const jobId = created[0].id;

  // 応答を返したあとも動き続ける(このアプリは常駐のNodeサーバーで動く前提)。
  // コンテナが落ちるとrunningのまま残るため、画面側で古いrunningは失敗として扱う
  void runExportJob(jobId, targetId);

  const { rows } = await query<ExportJob>(`${JOB_SELECT} where j.id = $1`, [
    jobId,
  ]);
  return NextResponse.json({ data: rows[0] });
}

/**
 * ZIPを組んで保存し、ジョブを done/failed にする。
 * **成功したときだけ、同じユーザーの古いジョブとファイルを消す**
 * (途中で失敗しても、前回のZIPは残しておく)。
 */
async function runExportJob(jobId: string, targetUserId: string) {
  try {
    const { zip, visitCount, photoCount } =
      await buildVisitExportZip(targetUserId);
    // 写真と同じく<ユーザーID>/配下に置く(人ごとにまとめて消せる)
    const relPath = `${targetUserId}/${jobId}.zip`;
    await saveExportZip(relPath, zip);

    const { rows: old } = await query<{ id: string; file_path: string | null }>(
      "select id, file_path from export_jobs where user_id = $1 and id <> $2",
      [targetUserId, jobId]
    );

    await query(
      `update export_jobs
          set status = 'done', file_path = $2, file_size = $3,
              visit_count = $4, photo_count = $5, error = null,
              finished_at = now()
        where id = $1`,
      [jobId, relPath, zip.length, visitCount, photoCount]
    );

    for (const row of old) {
      if (row.file_path) await deleteExportZip(row.file_path);
    }
    if (old.length > 0) {
      await query(
        "delete from export_jobs where id = any($1::uuid[])",
        [old.map((r) => r.id)]
      );
    }
  } catch (e) {
    await query(
      `update export_jobs
          set status = 'failed', error = $2, finished_at = now()
        where id = $1`,
      [jobId, e instanceof Error ? e.message : String(e)]
    );
  }
}
