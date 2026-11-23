import { test } from "node:test";
import assert from "node:assert/strict";
import { niceScaleMeters, scaleLabels } from "@/lib/mapScale";

test("物差しの全長は、測れる長さ以下で切りのよい値(1・2・5 × 10 のべき乗)", () => {
  assert.equal(niceScaleMeters(1234), 1000);
  assert.equal(niceScaleMeters(999), 500);
  assert.equal(niceScaleMeters(380), 200);
  assert.equal(niceScaleMeters(150), 100);
  assert.equal(niceScaleMeters(5000), 5000);
  assert.equal(niceScaleMeters(0.7), 0.5);
  // 測れないときは描かない
  assert.equal(niceScaleMeters(0), 0);
  assert.equal(niceScaleMeters(Number.NaN), 0);
});

test("数字は真ん中と右端。単位は右端にだけ付ける", () => {
  // 紙の地図によくある「0 ・ 500 ・ 1000m」
  assert.deepEqual(scaleLabels(1000), { half: "500", full: "1000m" });
  assert.deepEqual(scaleLabels(200), { half: "100", full: "200m" });
  // 2km からはキロメートル
  assert.deepEqual(scaleLabels(2000), { half: "1", full: "2km" });
  assert.deepEqual(scaleLabels(5000), { half: "2.5", full: "5km" });
  assert.deepEqual(scaleLabels(200000), { half: "100", full: "200km" });
});
