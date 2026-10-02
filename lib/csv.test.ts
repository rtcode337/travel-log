import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCsv, parseCsv } from "@/lib/csv";

test("区切り文字・引用符・改行を含む値は引用して書き、読み戻せる", () => {
  const rows = [
    ["name", "description"],
    ["清水寺", '「清水の舞台」, "国宝"\n2行目'],
    ["空欄", null],
  ];
  const text = buildCsv(rows);
  assert.equal(text.split("\r\n")[0], "name,description");
  assert.deepEqual(parseCsv(text), [
    ["name", "description"],
    ["清水寺", '「清水の舞台」, "国宝"\n2行目'],
    ["空欄", ""],
  ]);
});
