import { test } from "node:test";
import assert from "node:assert/strict";
import { formatJstDate, formatJstDateTime, jstDateStamp } from "@/lib/datetime";

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
