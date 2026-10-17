import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boundingBox,
  distanceMeters,
  formatDistance,
  isValidLatLng,
  parseOptionalLatLng,
} from "@/lib/coords";

test("空の座標は「指していない」として通す", () => {
  assert.deepEqual(parseOptionalLatLng(null, null), { ok: true, value: null });
  assert.deepEqual(parseOptionalLatLng(undefined, undefined), { ok: true, value: null });
});

test("範囲内の数の組は通す", () => {
  assert.deepEqual(parseOptionalLatLng(35.68, 139.76), {
    ok: true,
    value: { lat: 35.68, lng: 139.76 },
  });
  assert.equal(parseOptionalLatLng(-90, 180).ok, true);
});

test("片方だけ・範囲外・数でない値は弾く", () => {
  assert.equal(parseOptionalLatLng(35.68, null).ok, false);
  assert.equal(parseOptionalLatLng(null, 139.76).ok, false);
  assert.equal(parseOptionalLatLng(91, 139).ok, false);
  assert.equal(parseOptionalLatLng(35, -180.5).ok, false);
  assert.equal(parseOptionalLatLng("35.68", "139.76").ok, false);
  assert.equal(parseOptionalLatLng(Number.NaN, 139).ok, false);
  assert.equal(isValidLatLng(35, Number.POSITIVE_INFINITY), false);
});

test("距離はおおむね正しく、範囲は半径を含む", () => {
  const a = { lat: 35.681236, lng: 139.767125 };
  // 緯度0.001度はおよそ111m
  const d = distanceMeters(a, { lat: a.lat + 0.001, lng: a.lng });
  assert.ok(d > 105 && d < 117, `${d}`);
  const box = boundingBox(a, 300);
  const east = { lat: a.lat, lng: box.east };
  assert.ok(Math.abs(distanceMeters(a, east) - 300) < 3);
  assert.ok(box.south < a.lat && box.north > a.lat);
});

test("距離の表示", () => {
  assert.equal(formatDistance(12.4), "12m");
  assert.equal(formatDistance(1234), "1.2km");
});
