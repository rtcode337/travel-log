import { test } from "node:test";
import assert from "node:assert/strict";
import { isHoursUnknown, isOutOfTime } from "@/lib/periodFilter";

// 2026-01-15(木) 12:00 JST
const NOON_JAN = Date.UTC(2026, 0, 15, 3, 0);
// 2026-01-15(木) 23:00 JST
const NIGHT_JAN = Date.UTC(2026, 0, 15, 14, 0);
const OFF = { availableNow: false, openNow: false };

test("絞り込みを点けていなければ外れない", () => {
  assert.equal(isOutOfTime(OFF, { available_months: "6-8", opening_hours: "Mo-Su 10:00-11:00" }, NOON_JAN), false);
});

test("今手に入る: 時期外は外れ、時期が空(通年か不明)は外れない", () => {
  const f = { ...OFF, availableNow: true };
  assert.equal(isOutOfTime(f, { available_months: "6-8" }, NOON_JAN), true);
  assert.equal(isOutOfTime(f, { available_months: "11-3" }, NOON_JAN), false);
  assert.equal(isOutOfTime(f, { available_months: null }, NOON_JAN), false);
  assert.equal(isOutOfTime(f, null, NOON_JAN), false);
});

test("今営業中: 営業時間外も不明も外れる", () => {
  const f = { ...OFF, openNow: true };
  const hours = { opening_hours: "Mo-Su 11:00-15:00" };
  assert.equal(isOutOfTime(f, hours, NOON_JAN), false);
  assert.equal(isOutOfTime(f, hours, NIGHT_JAN), true);
  assert.equal(isOutOfTime(f, { opening_hours: null }, NIGHT_JAN), true);
  assert.equal(isOutOfTime(f, { opening_hours: "" }, NOON_JAN), true);
});

test("営業時間不明: 空・読めない書き方は不明、読める営業時間は営業時間外でも不明ではない", () => {
  assert.equal(isHoursUnknown({ opening_hours: null }, NOON_JAN), true);
  assert.equal(isHoursUnknown(null, NOON_JAN), true);
  assert.equal(isHoursUnknown({ opening_hours: "Mo-Su 11:00-15:00" }, NIGHT_JAN), false);
});
