import { test } from "node:test";
import assert from "node:assert/strict";
import {
  describeOpeningHours,
  normalizeOpeningHours,
  openingStateAt,
} from "@/lib/openingHours";

// JSTの日時から判定用のDateを作る(2026-10-19は月曜)
const jst = (day: number, time: string) =>
  new Date(`2026-10-${String(day).padStart(2, "0")}T${time}:00+09:00`);
const MON = 19;
const WED = 21;
const SAT = 24;
const SUN = 25;

const SAMPLE = "Mo-Fr 11:00-15:00,17:00-22:00; Sa,Su 11:00-21:00; We off";

test("曜日の範囲・複数の時間帯", () => {
  assert.equal(openingStateAt(SAMPLE, jst(MON, "12:00")), "open");
  assert.equal(openingStateAt(SAMPLE, jst(MON, "16:00")), "closed");
  assert.equal(openingStateAt(SAMPLE, jst(MON, "21:59")), "open");
  assert.equal(openingStateAt(SAMPLE, jst(MON, "22:00")), "closed");
  assert.equal(openingStateAt(SAMPLE, jst(SAT, "20:00")), "open");
  assert.equal(openingStateAt(SAMPLE, jst(SUN, "10:59")), "closed");
});

test("後の規則がその曜日を置き換える(We off)", () => {
  assert.equal(openingStateAt(SAMPLE, jst(WED, "12:00")), "closed");
});

test("時刻の後ろの , に曜日が続く規則は足す", () => {
  const value = "Mo-Fr 10:00-12:00, We 14:00-16:00";
  assert.equal(openingStateAt(value, jst(WED, "11:00")), "open");
  assert.equal(openingStateAt(value, jst(WED, "15:00")), "open");
  assert.equal(openingStateAt(value, jst(MON, "15:00")), "closed");
});

test("24/7 と曜日を書かない規則", () => {
  assert.equal(openingStateAt("24/7", jst(SUN, "03:00")), "open");
  assert.equal(openingStateAt("10:00-18:00", jst(SUN, "12:00")), "open");
  assert.equal(openingStateAt("10:00-18:00", jst(SUN, "18:30")), "closed");
});

test("日をまたぐ時間帯は翌日の朝まで営業", () => {
  const value = "Mo-Sa 18:00-02:00";
  assert.equal(openingStateAt(value, jst(MON, "23:00")), "open");
  // 月曜の夜から続く火曜の1時
  assert.equal(openingStateAt(value, jst(MON + 1, "01:30")), "open");
  assert.equal(openingStateAt(value, jst(MON + 1, "02:00")), "closed");
  // 日曜は休みだが、土曜の夜から続く日曜の1時は営業
  assert.equal(openingStateAt(value, jst(SUN, "01:00")), "open");
  assert.equal(openingStateAt(value, jst(SUN, "20:00")), "closed");
  // 月曜の1時は前日(日曜)が休みなので時間外
  assert.equal(openingStateAt(value, jst(MON, "01:00")), "closed");
  assert.equal(openingStateAt("Fr 18:00-26:00", jst(SAT, "01:00")), "open");
});

test("週をまたぐ曜日の範囲", () => {
  assert.equal(openingStateAt("Sa-Mo 10:00-17:00", jst(SUN, "12:00")), "open");
  assert.equal(openingStateAt("Sa-Mo 10:00-17:00", jst(WED, "12:00")), "closed");
});

test("「今」はJSTで数える(UTCでは日曜でもJSTでは月曜)", () => {
  // UTCの日曜20時 = JSTの月曜5時
  assert.equal(openingStateAt("Mo 05:00-06:00", new Date("2026-10-18T20:30:00Z")), "open");
});

test("読めない書き方を含むものは不明", () => {
  for (const value of [
    "Jan-Mar Mo-Fr 10:00-16:00",
    "week 01-10 Mo 10:00-12:00",
    "Mo[1] 10:00-12:00",
    "Mo-Fr 10:00+",
    "Mo-Fr sunrise-sunset",
    'Mo-Fr 10:00-18:00 "予約制"',
    "Mo-Fr 10:00-18:00 || Sa 10:00-12:00",
    "SH off",
    "Mo-Fr 10:00-18:00; SH off",
    "Mo-PH 10:00-18:00",
    "毎日 10:00-18:00",
  ]) {
    assert.equal(openingStateAt(value, jst(MON, "12:00")), "unknown", value);
  }
});

test("空は不明", () => {
  assert.equal(openingStateAt(null, jst(MON, "12:00")), "unknown");
  assert.equal(openingStateAt("", jst(MON, "12:00")), "unknown");
});

test("日本語の表記", () => {
  assert.deepEqual(describeOpeningHours(SAMPLE), {
    lines: ["月〜金 11:00〜15:00、17:00〜22:00", "土・日 11:00〜21:00", "水 休み"],
    unreadable: false,
  });
  assert.deepEqual(describeOpeningHours("24/7"), { lines: ["24時間営業"], unreadable: false });
  assert.deepEqual(describeOpeningHours("Mo-Sa 18:00-02:00"), {
    lines: ["月〜土 18:00〜翌2:00"],
    unreadable: false,
  });
  assert.deepEqual(describeOpeningHours("10:00-18:00; PH off"), {
    lines: ["毎日 10:00〜18:00", "祝日 休み"],
    unreadable: false,
  });
  assert.deepEqual(describeOpeningHours("Sa,Su,PH 10:00-17:00"), {
    lines: ["土・日・祝日 10:00〜17:00"],
    unreadable: false,
  });
  // 読めない規則は書いてあるまま
  assert.deepEqual(describeOpeningHours("10:00-18:00; SH off"), {
    lines: ["毎日 10:00〜18:00", "SH off"],
    unreadable: true,
  });
  assert.equal(describeOpeningHours(""), null);
});

test("保存は前後の空白を落とすだけで、読めない書き方も残す", () => {
  assert.equal(normalizeOpeningHours("  Mo 10:00-12:00 "), "Mo 10:00-12:00");
  assert.equal(normalizeOpeningHours("PH off"), "PH off");
  assert.equal(normalizeOpeningHours("   "), null);
});

// 2026-10-12(月)はスポーツの日、2026-09-22(火)は国民の休日、2026-10-13(火)は平日
const at = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`);

test("祝日でなければ PH の規則は飛ばす", () => {
  assert.equal(openingStateAt("Mo-Fr 11:00-22:00; PH off", at("2026-10-13", "12:00")), "open");
  assert.equal(openingStateAt("Mo-Fr 11:00-22:00; PH 10:00-17:00", at("2026-10-13", "20:00")), "open");
  assert.equal(openingStateAt("Sa,Su,PH 10:00-17:00", at("2026-10-13", "12:00")), "closed");
});

test("祝日なら PH の規則を当てる(後に書いたものが勝つ)", () => {
  assert.equal(openingStateAt("Mo-Fr 11:00-22:00; PH off", at("2026-10-12", "12:00")), "closed");
  assert.equal(openingStateAt("Mo-Fr 11:00-22:00; PH 10:00-17:00", at("2026-10-12", "10:30")), "open");
  assert.equal(openingStateAt("Mo-Fr 11:00-22:00; PH 10:00-17:00", at("2026-10-12", "20:00")), "closed");
  assert.equal(openingStateAt("Sa,Su,PH 10:00-17:00", at("2026-10-12", "12:00")), "open");
  // 国民の休日も祝日として数える
  assert.equal(openingStateAt("Mo-Fr 11:00-22:00; PH off", at("2026-09-22", "12:00")), "closed");
  // 先に PH を書くと、後の曜日の規則が勝つ
  assert.equal(openingStateAt("PH off; Mo-Fr 11:00-22:00", at("2026-10-12", "12:00")), "open");
});

test("日をまたぐ時間帯は、前の日が祝日かで決まる", () => {
  // 祝日の月曜の夜から火曜の朝まで
  assert.equal(openingStateAt("PH 18:00-02:00", at("2026-10-13", "01:00")), "open");
  assert.equal(openingStateAt("PH 18:00-02:00", at("2026-10-14", "01:00")), "closed");
});

test("祝日の対応範囲外の年で PH があれば不明", () => {
  assert.equal(openingStateAt("Mo-Fr 11:00-22:00; PH off", new Date("2100-01-04T12:00:00+09:00")), "unknown");
  // PH を使わなければ範囲外の年でも判定する
  assert.equal(openingStateAt("Mo-Fr 11:00-22:00", new Date("2100-01-04T12:00:00+09:00")), "open");
});
