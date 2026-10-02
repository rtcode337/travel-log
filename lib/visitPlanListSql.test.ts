import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePlanSpotIds } from "@/lib/visitPlanListSql";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

test("重複を除いて並び順を保つ", () => {
  assert.deepEqual(parsePlanSpotIds([A, B, A]), [A, B]);
});

test("未指定は空配列", () => {
  assert.deepEqual(parsePlanSpotIds(undefined), []);
  assert.deepEqual(parsePlanSpotIds(null), []);
});

// 1つでも混ざれば全体を断る(通すと削除のあとのキャストで失敗し、経由スポットが消えていた)
test("UUIDでない値や配列でない値はnull", () => {
  assert.equal(parsePlanSpotIds([A, "abc"]), null);
  assert.equal(parsePlanSpotIds([A, 1]), null);
  assert.equal(parsePlanSpotIds("abc"), null);
});
