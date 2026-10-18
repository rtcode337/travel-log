import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatAvailableMonths,
  isAvailableInMonth,
  isAvailableNow,
  normalizeAvailableMonths,
} from "@/lib/availableMonths";

test("範囲・列挙・混在を読んで、保存する形に整える", () => {
  assert.deepEqual(normalizeAvailableMonths("11-3"), { ok: true, value: "11-3" });
  assert.deepEqual(normalizeAvailableMonths(" 6, 7 ,8 "), { ok: true, value: "6,7,8" });
  assert.deepEqual(normalizeAvailableMonths("12-02,07"), { ok: true, value: "12-2,7" });
  assert.deepEqual(normalizeAvailableMonths("3-3"), { ok: true, value: "3" });
});

test("空は通年か不明(null)", () => {
  assert.deepEqual(normalizeAvailableMonths(""), { ok: true, value: null });
  assert.deepEqual(normalizeAvailableMonths("  "), { ok: true, value: null });
  assert.deepEqual(normalizeAvailableMonths(null), { ok: true, value: null });
});

test("壊れた値はエラーにする", () => {
  for (const raw of ["1 1-3", "13", "0-3", "11〜3", "冬", "1-2-3", "1,,2", "6,", "-3"]) {
    assert.equal(normalizeAvailableMonths(raw).ok, false, raw);
  }
});

test("年をまたぐ範囲", () => {
  assert.equal(isAvailableInMonth("11-3", 12), true);
  assert.equal(isAvailableInMonth("11-3", 1), true);
  assert.equal(isAvailableInMonth("11-3", 3), true);
  assert.equal(isAvailableInMonth("11-3", 4), false);
  assert.equal(isAvailableInMonth("11-3", 10), false);
  assert.equal(isAvailableInMonth("12-2,7", 7), true);
  assert.equal(isAvailableInMonth("12-2,7", 6), false);
});

test("空は手に入る側に数える", () => {
  assert.equal(isAvailableInMonth(null, 5), true);
  assert.equal(isAvailableInMonth("", 5), true);
});

test("今の月はJSTで数える(UTCでは前月の末日でも、JSTでは翌月)", () => {
  // UTCの10月31日16時 = JSTの11月1日1時
  assert.equal(isAvailableNow("11-3", new Date("2026-10-31T16:00:00Z")), true);
  assert.equal(isAvailableNow("11-3", new Date("2026-10-31T14:00:00Z")), false);
});

test("日本語の表記", () => {
  assert.equal(formatAvailableMonths("11-3"), "11月〜3月");
  assert.equal(formatAvailableMonths("6,7,8"), "6月・7月・8月");
  assert.equal(formatAvailableMonths("12-2,7"), "12月〜2月・7月");
  assert.equal(formatAvailableMonths("1-12"), "通年");
  assert.equal(formatAvailableMonths("4-3"), "通年");
  assert.equal(formatAvailableMonths(null), null);
});
