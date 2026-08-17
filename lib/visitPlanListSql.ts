/**
 * 訪問予定リスト1件ぶんの列。経由スポットはseq順の `spot_ids` にまとめ、
 * そのうち訪問済み(`visited_at`あり)のものを `visited_spot_ids` に抜き出す
 * (訪問済みも `spot_ids` には残る —— リストから消さずに経路からだけ外すため)。
 *
 * 一覧(`/api/visit-plan-lists`)・1件(`/api/visit-plan-lists/[id]`)・訪問済みの
 * 付け外し(`.../items/[spotId]`)で返す形をそろえるために共有している。
 * 呼び出し側は `select ${PLAN_LIST_COLUMNS} from visit_plan_lists l
 * left join visit_plan_list_items i on i.list_id = l.id where ... group by l.id`
 * の形で使う。
 */
export const PLAN_LIST_COLUMNS = `
  l.id, l.spot_type_id, l.title, l.description,
  to_char(l.start_date, 'YYYY-MM-DD') as start_date,
  to_char(l.end_date, 'YYYY-MM-DD') as end_date,
  l.archived_at, l.created_at, l.updated_at,
  coalesce(
    array_agg(i.spot_id order by i.seq)
      filter (where i.spot_id is not null),
    '{}'
  ) as spot_ids,
  coalesce(
    array_agg(i.spot_id order by i.seq)
      filter (where i.visited_at is not null),
    '{}'
  ) as visited_spot_ids
`;
