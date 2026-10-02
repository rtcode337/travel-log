import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePlanDates } from "@/lib/visitPlanListDates";

test("両方空は訪問日未定", () => {
  assert.deepEqual(normalizePlanDates({}), { ok: true, start: null, end: null });
});

test("開始日だけなら単日", () => {
  assert.deepEqual(normalizePlanDates({ start_date: "2026-11-23" }), {
    ok: true,
    start: "2026-11-23",
    end: "2026-11-23",
  });
});

test("終了日だけ・逆順・形式違いは断る", () => {
  assert.equal(normalizePlanDates({ end_date: "2026-11-23" }).ok, false);
  assert.equal(
    normalizePlanDates({ start_date: "2026-11-24", end_date: "2026-11-23" }).ok,
    false
  );
  assert.equal(normalizePlanDates({ start_date: "2026/11/23" }).ok, false);
});
