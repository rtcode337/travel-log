-- 公開スポットのダウンロードを limit/offset の分割取得にしたため、その並び
-- (spot_type_id → region → name → id)に沿った索引を足す。
-- 無いとチャンクごとに該当行を全部ソートし直すことになる(5万件規模の種別では26回)。
-- id を含めるのは全順序にするため —— region・name だけでは同値の行の順が
-- 実行ごとに変わりうるので、offset で分けると重複・取りこぼしが出る。
create index if not exists spots_download_order_idx
  on spots (spot_type_id, region, name, id);
