import type { Pool, PoolClient } from "pg";

/**
 * 訪問記録を消す前に、消える記録が持つ写真のパスを全部集める。
 *
 * **追記(`visit_notes`)の写真も一緒に集める。** 追記は訪問記録の削除に
 * `on delete cascade`で連れて消えるので、行だけ消えて写真の実体が残る
 * (かつては`visits.photos`だけを集めていて、追記の写真が退会後も残っていた)。
 * 消し方の経路(記録の削除・スポットの削除・一括削除・種別削除・退会)ごとに
 * 書くと片方だけ漏れるので、どこもここを通す。
 *
 * `visitIdsSql`は消える訪問記録の`id`を1列で返すSELECT(コード側の定数だけを渡すこと。
 * 値は`params`でプレースホルダーに渡す)。行が消えるのと同じトランザクションで呼ぶ。
 */
export async function collectVisitPhotoPaths(
  db: Pool | PoolClient,
  visitIdsSql: string,
  params: unknown[]
): Promise<string[]> {
  const { rows } = await db.query<{ path: string }>(
    `with target as (${visitIdsSql})
     select unnest(v.photos) as path from visits v
      where v.id in (select id from target)
     union all
     select unnest(n.photos) from visit_notes n
      where n.visit_id in (select id from target)`,
    params
  );
  return rows.map((r) => r.path);
}
