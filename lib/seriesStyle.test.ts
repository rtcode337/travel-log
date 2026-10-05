import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mergeSeriesStyles,
  seriesForExisting,
  SERIES_STYLES_SETTING_KEY,
} from "@/lib/seriesStyle";
import { parseSpotTypeDefinition } from "@/lib/types";

const current = [
  { series: "和食", icon: "M0 0h24v24H0z", color: "#123456" },
  { series: "カレー", label: "カレ" },
];
const incoming = [
  { series: "ラーメン", label: "ラー", color: "#aaaaaa" },
  { series: "和食", label: "和食", color: "#bbbbbb" },
];

test("見た目を残すときは、既にあるシリーズの定義を今のまま使う", () => {
  assert.deepEqual(mergeSeriesStyles(current, incoming), [
    // 並びは取り込むほう。無かったシリーズだけが足される
    { series: "ラーメン", label: "ラー", color: "#aaaaaa" },
    { series: "和食", icon: "M0 0h24v24H0z", color: "#123456" },
    // 取り込むほうに無いシリーズは後ろに残す(別の範囲にしか無いシリーズ)
    { series: "カレー", label: "カレ" },
  ]);
});

test("見た目を残すと書いていなければ、今までどおり定義で上書きする", () => {
  const type = { settings: { [SERIES_STYLES_SETTING_KEY]: JSON.stringify(current) } };
  assert.deepEqual(seriesForExisting({ series: incoming }, type), incoming);
  assert.deepEqual(
    seriesForExisting({ series: incoming, keep_series_styles: true }, type),
    mergeSeriesStyles(current, incoming)
  );
  // シリーズを持たない定義はシリーズに触らない
  assert.equal(seriesForExisting({ keep_series_styles: true }, type), undefined);
});

test("定義ファイルの keep_series_styles を読む", () => {
  const parsed = parseSpotTypeDefinition({ key: "dining", label: "食事処", keep_series_styles: true });
  assert.ok("data" in parsed && parsed.data.keep_series_styles === true);
  assert.ok("error" in parseSpotTypeDefinition({ key: "dining", label: "食事処", keep_series_styles: "yes" }));
});
