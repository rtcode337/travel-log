import { test } from "node:test";
import assert from "node:assert/strict";
import { hasAllCategories } from "@/lib/category";

test("カテゴリの絞り込みは、選んだものを全部持つスポットだけ通す(AND)", () => {
  assert.equal(hasAllCategories(["ランチ", "個室"], ["ランチ", "個室"]), true);
  assert.equal(hasAllCategories(["ランチ", "個室", "駅近"], ["ランチ"]), true);
  assert.equal(hasAllCategories(["ランチ"], ["ランチ", "個室"]), false);
  assert.equal(hasAllCategories([], ["ランチ"]), false);
  // 何も選んでいなければ絞らない
  assert.equal(hasAllCategories([], []), true);
});
