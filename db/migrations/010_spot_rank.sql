-- 010: spots に rank(A〜E)列を追加
--
-- 「重要度・知名度の段階」を series から切り出して rank にした。
-- かつては観光地の A〜E も作品名・企画名も同じ series に入れていたが、
-- 前者は種別をまたいで同じ意味(A が一番大きく目立つ)でアプリに決め打ちできるのに対し、
-- 後者は種別ごとに中身が違うので設定(series_styles)で持つしかなく、
-- 「シリーズ」1語で説明できなくなっていた。
--
-- **既存の series の値はここでは動かさない**。どの種別がランクを使うのかは
-- 種別ごとの設定(rank_enabled)次第で、移行の判断はデータ側(travel-log-data の
-- CSV と settings.json)で行う。ランクが要る種別は rank 列付きの CSV を
-- 入れ直すことで埋まる。

alter table spots add column if not exists rank text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'spots_rank_check'
  ) then
    alter table spots
      add constraint spots_rank_check check (rank in ('A', 'B', 'C', 'D', 'E'));
  end if;
end $$;

create index if not exists spots_rank_idx on spots (rank);
