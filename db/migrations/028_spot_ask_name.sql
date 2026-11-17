-- スポットに「生成AIに聞くときの名前」を持たせる。nullなら今までどおりnameで聞くので、
-- 既存の行は空のままでよい。
alter table spots add column if not exists ask_name text;
