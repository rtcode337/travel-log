import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCsv, parseCsv } from "@/lib/csv";
import {
  buildVisitCsvRow,
  parseVisitCsv,
  VISIT_CSV_HEADER,
  visitCsvPosition,
  type VisitCsvRecord,
} from "@/lib/visitExportCsv";

const base: VisitCsvRecord = {
  name: "サンプル名物",
  nameKana: "さんぷるめいぶつ",
  lat: 35.681236,
  lng: 139.767125,
  region: "東京都",
  series: "麺",
  categories: "ラーメン|名物",
  visitedAt: "2026-08-17 12:30",
  memo: "1軒目",
  notes: "",
  photos: "photos/a.jpg",
  unvisited: false,
  placeLat: null,
  placeLng: null,
};

test("行った場所の列は末尾に足してあり、既存の列の位置は変えない", () => {
  // 古いファイルの見出し(行った場所の列が入る前)がそのまま先頭に並んでいること
  assert.deepEqual(VISIT_CSV_HEADER.slice(0, 12), [
    "スポット名",
    "ふりがな",
    "緯度",
    "経度",
    "地域",
    "シリーズ",
    "カテゴリ",
    "訪問日時(JST)",
    "メモ",
    "追記",
    "写真",
    "未訪問記録",
  ]);
  assert.deepEqual(VISIT_CSV_HEADER.slice(12), ["行った場所の緯度", "行った場所の経度"]);
  assert.equal(buildVisitCsvRow(base).length, VISIT_CSV_HEADER.length);
});

test("書き出して読み戻せる(行った場所あり・なし)", () => {
  const withPlace = { ...base, memo: "2軒目", placeLat: 35.6895, placeLng: 139.6917 };
  const text = "﻿" + buildCsv([[...VISIT_CSV_HEADER], buildVisitCsvRow(base), buildVisitCsvRow(withPlace)]);
  const records = parseVisitCsv(parseCsv(text));
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], base);
  assert.deepEqual(records[1], withPlace);
  // 訪問の位置は行った場所が優先、無ければスポットの位置
  assert.deepEqual(visitCsvPosition(records[0]), { lat: base.lat, lng: base.lng });
  assert.deepEqual(visitCsvPosition(records[1]), { lat: 35.6895, lng: 139.6917 });
});

test("行った場所の列が無い古いファイルも読み戻せる", () => {
  const oldHeader = VISIT_CSV_HEADER.slice(0, 12);
  const oldRow = buildVisitCsvRow(base).slice(0, 12);
  const records = parseVisitCsv(parseCsv("﻿" + buildCsv([[...oldHeader], oldRow])));
  assert.equal(records.length, 1);
  assert.equal(records[0].name, "サンプル名物");
  assert.equal(records[0].placeLat, null);
  assert.deepEqual(visitCsvPosition(records[0]), { lat: base.lat, lng: base.lng });
});

test("片方だけの行った場所は指していないものとして読む", () => {
  const row = buildVisitCsvRow({ ...base, placeLat: 35.6, placeLng: null });
  const records = parseVisitCsv(parseCsv(buildCsv([[...VISIT_CSV_HEADER], row])));
  assert.equal(records[0].placeLat, null);
  assert.equal(records[0].placeLng, null);
});
