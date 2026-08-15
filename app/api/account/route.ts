import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { deleteVisitPhotos } from "@/lib/photos";
import { deleteExportZip } from "@/lib/exportStorage";
import { SESSION_COOKIE } from "@/lib/auth/session";

// 写真が多いユーザーではファイルの削除に時間がかかるため、既定(10秒)では足りない
// (Vercelのサーバーレス関数の上限。指定の無いホストでは無視される)
export const maxDuration = 60;

/**
 * アカウント削除(本人による自分のアカウントの削除)。
 *
 * **消えるもの**: アカウント行(メールアドレス・Googleの紐付け・パスワード)と、
 * FKの`on delete cascade`で連れて消える訪問記録・訪問予定・訪問予定リスト・
 * 口コミ・非表示設定・エクスポートジョブ。加えて、行が消える前に集めた
 * **写真ファイル**とエクスポートZIPの実体、および**自分の非公開スポット**
 * (`status='private'`。本人にしか見えない=個人のデータのため)。
 *
 * **残るもの**: 公開・承認待ち・却下のスポットと、登録したルート。
 * `created_by`が`on delete set null`なので登録者だけが外れて実体は残る
 * (他のユーザーの地図から突然スポットが消えないようにするため)。
 *
 * 管理者による他人の削除は`/api/admin/users/[id]`のDELETE。**あちらと違い、
 * 最後の管理者かどうかのガードはここでも要る** —— 自分でアカウントを削除して誰も
 * 管理画面に入れなくなるのを防ぐため。
 */
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (user.role === "admin") {
    const { rows } = await query<{ count: string }>(
      "select count(*) from users where role = 'admin' and id != $1",
      [user.id]
    );
    if (Number(rows[0].count) === 0) {
      return NextResponse.json(
        {
          error:
            "最後の管理者はアカウントを削除できません。先に別のユーザーを管理者にしてください。",
        },
        { status: 400 }
      );
    }
  }

  const client = await pool.connect();
  let photoPaths: string[] = [];
  let exportPaths: string[] = [];
  try {
    await client.query("begin");

    // 実体のあるファイルは、行がカスケードで消える前にパスを集めておく。
    // 非公開スポットに紐づく自分の訪問記録もこのSELECTに含まれる
    const photos = await client.query<{ photos: string[] }>(
      "select photos from visits where user_id = $1",
      [user.id]
    );
    photoPaths = photos.rows.flatMap((r) => r.photos);

    const exports = await client.query<{ file_path: string | null }>(
      "select file_path from export_jobs where user_id = $1",
      [user.id]
    );
    exportPaths = exports.rows
      .map((r) => r.file_path)
      .filter((p): p is string => Boolean(p));

    // 非公開スポットは本人にしか見えない個人のデータなので一緒に消す
    // (公開・承認待ち・却下は残し、created_byだけがnullになる)
    await client.query(
      "delete from spots where created_by = $1 and status = 'private'",
      [user.id]
    );
    await client.query("delete from users where id = $1", [user.id]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "アカウントの削除に失敗しました。" },
      { status: 500 }
    );
  } finally {
    client.release();
  }

  // ファイルの削除はDBのコミット後。失敗しても削除自体は成立させる
  // (孤児ファイルが残るだけで、参照する行はもう無い)
  await deleteVisitPhotos(photoPaths);
  for (const path of exportPaths) {
    await deleteExportZip(path).catch(() => {});
  }

  // 消えたユーザーのセッションを残さない
  const response = NextResponse.json({ data: { ok: true } });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
