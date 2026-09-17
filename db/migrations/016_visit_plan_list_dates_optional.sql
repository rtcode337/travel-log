-- 016: 訪問予定リストの開始日・終了日を任意にする(null = 訪問日未定)
--
-- 行き先だけ決めて日取りはこれから、というリストを作れるようにする。
-- null は「未定」で、一覧では日付の入ったリストより後ろに並ぶ。
-- 開始日と終了日はセットで扱い、片方だけ入った状態は check 制約で作らせない
-- (「開始日なしの終了日」は意味を持たず、並び順や天気の基準日も決まらないため)。
--
-- 既存の行はどちらも not null だったので、この移行で内容は変わらない。
--
-- 全文idempotent。
--
-- 適用はアプリ(scripts/migrate.mjs)が起動時に自動で行う。
-- トランザクションと schema_migrations への記録もそちらが受け持つため、
-- このファイルに begin/commit や記録のinsertは書かない。

alter table visit_plan_lists
  alter column start_date drop not null,
  alter column end_date drop not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'visit_plan_lists'::regclass
       and conname = 'visit_plan_lists_dates_ck'
  ) then
    alter table visit_plan_lists
      add constraint visit_plan_lists_dates_ck
      check ((start_date is null) = (end_date is null));
  end if;
end $$;
