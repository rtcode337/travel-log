/**
 * spot_types + spot_type_settings(EAV)を結合し、settingsをjsonbオブジェクトに
 * まとめて1行で返すSELECTの共通部分。`from spot_types t`までを含むので、
 * 呼び出し側は `where`/`order by` を続けて書くだけでよい。
 *
 * **一覧の並びは`SPOT_TYPE_ORDER`を使う**(sort_order → 作成順)。
 * 並び順は管理画面から変えられるので、created_atだけで並べると設定が効かない。
 */
export const SPOT_TYPE_SELECT = `
  select t.*, coalesce(
    (select jsonb_object_agg(s.key, s.value)
     from spot_type_settings s
     where s.spot_type_id = t.id),
    '{}'::jsonb
  ) as settings
  from spot_types t`;

/** 種別を画面に並べる順。sort_orderが同じなら作成順(既定値0のときの従来の並び) */
export const SPOT_TYPE_ORDER = "order by t.sort_order asc, t.created_at asc";
