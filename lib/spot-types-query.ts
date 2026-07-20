/**
 * spot_types + spot_type_settings(EAV)を結合し、settingsをjsonbオブジェクトに
 * まとめて1行で返すSELECTの共通部分。`from spot_types t`までを含むので、
 * 呼び出し側は `where`/`order by` を続けて書くだけでよい。
 */
export const SPOT_TYPE_SELECT = `
  select t.*, coalesce(
    (select jsonb_object_agg(s.key, s.value)
     from spot_type_settings s
     where s.spot_type_id = t.id),
    '{}'::jsonb
  ) as settings
  from spot_types t`;
