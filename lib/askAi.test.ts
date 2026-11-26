import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGeminiAskUrl, normalizeAskName } from "@/lib/askAi";
import type { Spot } from "@/lib/types";

const spot = (fields: Partial<Spot>): Spot =>
  ({
    id: "1",
    spot_type_id: "t",
    key: null,
    name: "名物そば",
    name_kana: null,
    lat: 35.68,
    lng: 139.76,
    region: "東京都",
    rank: null,
    series: null,
    categories: [],
    description: null,
    available_months: null,
    opening_hours: null,
    ask_name: null,
    status: "published",
    origin: "csv",
    created_by: null,
    created_at: "",
    updated_at: "",
    ...fields,
  }) as Spot;

const question = (s: Spot) =>
  new URL(buildGeminiAskUrl(s)).searchParams.get("q") ?? "";

test("生成AIには、聞くときの名前があればそちらで聞く", () => {
  // 料理名のスポットで、行き先(代表の店)の営業時間・アクセスを聞くため
  const q = question(spot({ ask_name: "見本屋 本店(名物そば)" }));
  assert.match(q, /^「見本屋 本店\(名物そば\)」/);
});

test("聞くときの名前が無ければ、スポット名で聞く", () => {
  assert.match(question(spot({})), /^「名物そば」/);
  // 空白だけの値も無いのと同じ
  assert.match(question(spot({ ask_name: "  " })), /^「名物そば」/);
});

test("聞くときの名前は前後の空白を落とし、空ならnull", () => {
  assert.equal(normalizeAskName(" 見本屋 "), "見本屋");
  assert.equal(normalizeAskName(""), null);
  assert.equal(normalizeAskName(null), null);
  assert.equal(normalizeAskName(undefined), null);
});

test("名物・おすすめも聞く(食事処ならそこで何を頼むかを知りたい)", () => {
  assert.match(question(spot({})), /名物やおすすめ/);
});

test("質問文は短く保つ(Googleの確かめる画面は、最後までスクロールしないと続行できない)", () => {
  const q = question(spot({}));
  const body = q.replace(/^「名物そば」\([^)]*\)/, "");
  assert.ok(body.length <= 120, `名前と所在地を除いて ${body.length} 字`);
});
