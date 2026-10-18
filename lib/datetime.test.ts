import { test } from "node:test";
import assert from "node:assert/strict";
import { formatJstDate, formatJstDateTime, jstClock, jstDateStamp } from "@/lib/datetime";

// 実行環境のTZに依らず日本時間で出ること(UTCの15:05は翌日の0:05)
test("UTCの日時を日本時間で書式化する", () => {
  assert.equal(formatJstDateTime("2026-10-01T15:05:00Z"), "2026/10/2 00:05");
  assert.equal(formatJstDate("2026-10-01T15:05:00Z"), "2026/10/2");
  assert.equal(jstDateStamp("2026-10-01T15:05:00Z"), "20261002");
});

test("元の時差を持った日時も日本時間に直す", () => {
  assert.equal(formatJstDateTime("2026-10-01T09:30:00-05:00"), "2026/10/1 23:30");
});

test("読めない値は空文字", () => {
  assert.equal(formatJstDateTime("not a date"), "");
  assert.equal(jstDateStamp("not a date"), "");
});

test("JSTの月・曜日(月曜=0)・経過分", () => {
  // UTCの日曜15:30 = JSTの月曜0:30
  assert.deepEqual(jstClock("2026-10-18T15:30:00Z"), { year: 2026, month: 10, day: 19, weekday: 0, minutes: 30 });
  // UTCの10月31日16:00 = JSTの11月1日(日曜)1:00
  assert.deepEqual(jstClock("2026-10-31T16:00:00Z"), { year: 2026, month: 11, day: 1, weekday: 6, minutes: 60 });
  assert.equal(jstClock("not a date"), null);
});
