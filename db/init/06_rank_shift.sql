-- 必訪ランク表記をS/A/B/C/DからA/B/C/D/Eへ一律シフトするマイグレーション
-- (最上位をSにすると運用上何かと面倒なため、一段ずつ繰り下げる。lib/types.tsのコメント参照)。
-- 02_tourist_spots.sql・03_goshuin_spots.sqlの投入データは旧S〜D表記のままなので、
-- 新規DB・既存DBのどちらでもこのファイルが投入後に一度だけシフトを適用する。
-- 既存の db/data/ があるDBへは手動で適用する(CLAUDE.md参照):
--   docker compose -f docker-compose.dev.yml exec -T db psql -U travel_log -d travel_log < db/init/06_rank_shift.sql
do $$
begin
  if exists (select 1 from spots where rank = 'S') then
    update spots set rank = 'E' where rank = 'D';
    update spots set rank = 'D' where rank = 'C';
    update spots set rank = 'C' where rank = 'B';
    update spots set rank = 'B' where rank = 'A';
    update spots set rank = 'A' where rank = 'S';
  end if;
end
$$;
