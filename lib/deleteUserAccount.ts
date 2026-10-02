import { pool } from "@/lib/db";
import { deleteVisitPhotos } from "@/lib/photos";
import { deleteUserExportZips } from "@/lib/exportStorage";
import { collectVisitPhotoPaths } from "@/lib/visitPhotoPaths";

/** 消そうとしたのが最後の管理者だったときに投げる */
export class LastAdminError extends Error {}

/**
 * ユーザーを1人、個人のデータごと消す。本人の退会(`DELETE /api/account`)と
 * 管理者による削除(`DELETE /api/admin/users/[id]`)の両方がここを通る ——
 * 経路ごとに書くと後始末の範囲が食い違う(かつて管理者による削除は`users`の行を
 * 消すだけで、写真・ZIP・非公開スポットが残っていた)。
 *
 * **消えるもの**: アカウント行と、FKの`on delete cascade`で連れて消える訪問記録・追記・
 * 訪問予定・訪問予定リスト・口コミ・非表示設定・エクスポートジョブ。加えて、
 * 行が消える前に集めた**写真ファイル**(追記の写真も)とエクスポートZIPの実体、
 * および**本人の非公開スポット**(`status='private'`。本人にしか見えない=個人のデータ)。
 *
 * **残るもの**: 公開・承認待ち・却下のスポットと、登録したルート
 * (`created_by`が`on delete set null`。他のユーザーの地図から突然消えないように)。
 *
 * **最後の管理者は消せない**(`LastAdminError`)。判定は削除と同じトランザクションで
 * 管理者の行をロックしてから数える —— 先に数えてから消すと、管理者2人が同時に
 * 互いを消したときに0人になる。
 */
export async function deleteUserAccount(userId: string): Promise<void> {
  const client = await pool.connect();
  let photoPaths: string[] = [];
  try {
    await client.query("begin");

    const admins = await client.query<{ id: string }>(
      "select id from users where role = 'admin' for update"
    );
    const isAdmin = admins.rows.some((r) => r.id === userId);
    if (isAdmin && admins.rows.length <= 1) throw new LastAdminError();

    // 実体のあるファイルは、行がカスケードで消える前にパスを集めておく。
    // 非公開スポットに紐づく本人の訪問記録もここに含まれる
    photoPaths = await collectVisitPhotoPaths(
      client,
      "select id from visits where user_id = $1",
      [userId]
    );

    // 非公開スポットは本人にしか見えない個人のデータなので一緒に消す
    // (公開・承認待ち・却下は残し、created_byだけがnullになる)
    await client.query(
      "delete from spots where created_by = $1 and status = 'private'",
      [userId]
    );
    await client.query("delete from users where id = $1", [userId]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // ファイルの削除はDBのコミット後。失敗しても削除自体は成立させる
  // (孤児ファイルが残るだけで、参照する行はもう無い)
  await deleteVisitPhotos(photoPaths).catch(() => {});
  await deleteUserExportZips(userId);
}
