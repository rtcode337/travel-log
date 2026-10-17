import { test } from "node:test";
import assert from "node:assert/strict";
import { parseExifGps, parseExifTakenAt, photoGpsFailureMessage } from "@/lib/exif";

/**
 * 検査用の最小のJPEG(SOI + APP1(Exif) + SOS)をバイト列で組み立てる。
 * 画像データそのものは要らない(読むのはSOSより前のExifだけ)ので、SOSの直後で終える。
 */
type Dms = [number, number, number];
function buildJpeg(opts: {
  little?: boolean;
  gps?: { lat: Dms; latRef?: string; lng: Dms; lngRef?: string };
  /** "YYYY:MM:DD HH:MM:SS" */
  takenAt?: string;
}): ArrayBuffer {
  const little = opts.little ?? true;
  const tiff: number[] = [];
  const u16 = (at: number, v: number) => {
    const b = little ? [v & 0xff, (v >> 8) & 0xff] : [(v >> 8) & 0xff, v & 0xff];
    tiff[at] = b[0];
    tiff[at + 1] = b[1];
  };
  const u32 = (at: number, v: number) => {
    const bytes = [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
    const b = little ? bytes : bytes.reverse();
    for (let i = 0; i < 4; i++) tiff[at + i] = b[i];
  };
  const pad = (n: number) => {
    for (let i = 0; i < n; i++) tiff.push(0);
  };

  // TIFFヘッダ
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]));
  pad(2);
  u16(2, 0x2a);
  pad(4);
  u32(4, 8);

  // IFD0
  const ifd0Entries: [number, number][] = []; // [tag, オフセットを書き込む位置]
  const ifd0Count = (opts.gps ? 1 : 0) + (opts.takenAt ? 1 : 0);
  const ifd0 = tiff.length;
  pad(2 + ifd0Count * 12 + 4);
  u16(ifd0, ifd0Count);
  let e = 0;
  const entry = (base: number, index: number, tag: number, type: number, count: number) => {
    const at = base + 2 + index * 12;
    u16(at, tag);
    u16(at + 2, type);
    u32(at + 4, count);
    return at + 8; // 値・オフセットの位置
  };
  if (opts.gps) ifd0Entries.push([0x8825, entry(ifd0, e++, 0x8825, 4, 1)]);
  if (opts.takenAt) ifd0Entries.push([0x8769, entry(ifd0, e++, 0x8769, 4, 1)]);

  if (opts.gps) {
    const gpsIfd = tiff.length;
    u32(ifd0Entries.find(([t]) => t === 0x8825)![1], gpsIfd);
    pad(2 + 4 * 12 + 4);
    u16(gpsIfd, 4);
    const latRefAt = entry(gpsIfd, 0, 1, 2, 2);
    const latAt = entry(gpsIfd, 1, 2, 5, 3);
    const lngRefAt = entry(gpsIfd, 2, 3, 2, 2);
    const lngAt = entry(gpsIfd, 3, 4, 5, 3);
    tiff[latRefAt] = (opts.gps.latRef ?? "N").charCodeAt(0);
    tiff[lngRefAt] = (opts.gps.lngRef ?? "E").charCodeAt(0);
    const writeDms = (valueAt: number, dms: Dms) => {
      const data = tiff.length;
      u32(valueAt, data);
      pad(24);
      // 秒は100分の1まで持たせる(実機のExifに多い書き方)
      const [d, m, s] = dms;
      u32(data, d);
      u32(data + 4, 1);
      u32(data + 8, m);
      u32(data + 12, 1);
      u32(data + 16, Math.round(s * 100));
      u32(data + 20, 100);
    };
    writeDms(latAt, opts.gps.lat);
    writeDms(lngAt, opts.gps.lng);
  }

  if (opts.takenAt) {
    const exifIfd = tiff.length;
    u32(ifd0Entries.find(([t]) => t === 0x8769)![1], exifIfd);
    pad(2 + 12 + 4);
    u16(exifIfd, 1);
    const valueAt = entry(exifIfd, 0, 0x9003, 2, 20);
    const data = tiff.length;
    u32(valueAt, data);
    for (const ch of opts.takenAt) tiff.push(ch.charCodeAt(0));
    tiff.push(0);
  }

  const app1Body = [..."Exif".split("").map((c) => c.charCodeAt(0)), 0, 0, ...tiff];
  const len = app1Body.length + 2;
  const bytes = [
    0xff, 0xd8, // SOI
    0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...app1Body, // APP1
    0xff, 0xda, 0x00, 0x02, // SOS(ここから先は読まない)
  ];
  return new Uint8Array(bytes).buffer;
}

// 東京駅のあたり(北緯35度40分52.20秒・東経139度46分1.32秒)
const TOKYO = { lat: [35, 40, 52.2] as Dms, lng: [139, 46, 1.32] as Dms };

test("GPS付きのJPEGから緯度・経度を読む(リトルエンディアン)", () => {
  const result = parseExifGps(buildJpeg({ gps: TOKYO }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(Math.abs(result.lat - (35 + 40 / 60 + 52.2 / 3600)) < 1e-9);
  assert.ok(Math.abs(result.lng - (139 + 46 / 60 + 1.32 / 3600)) < 1e-9);
});

test("ビッグエンディアンのExifも読める", () => {
  const result = parseExifGps(buildJpeg({ gps: TOKYO, little: false }));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(Math.abs(result.lat - 35.6811666) < 1e-6);
});

test("南緯・西経は負の値になる", () => {
  const result = parseExifGps(
    buildJpeg({ gps: { lat: [33, 52, 0], latRef: "S", lng: [151, 12, 0], lngRef: "W" } })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.lat < 0 && result.lng < 0);
});

test("GPSの無いJPEGは no-gps(撮影日時は読める)", () => {
  const jpeg = buildJpeg({ takenAt: "2026:08:17 10:23:45" });
  assert.deepEqual(parseExifGps(jpeg), { ok: false, reason: "no-gps" });
  const takenAt = parseExifTakenAt(jpeg);
  assert.ok(takenAt);
  assert.equal(takenAt.getFullYear(), 2026);
  assert.equal(takenAt.getMonth(), 7);
  assert.equal(takenAt.getHours(), 10);
});

test("GPSと撮影日時の両方を持つJPEGから、どちらも読める", () => {
  const jpeg = buildJpeg({ gps: TOKYO, takenAt: "2026:08:17 10:23:45" });
  assert.equal(parseExifGps(jpeg).ok, true);
  assert.equal(parseExifTakenAt(jpeg)?.getMinutes(), 23);
});

test("(0, 0)は測位できなかった印として位置にしない", () => {
  const result = parseExifGps(buildJpeg({ gps: { lat: [0, 0, 0], lng: [0, 0, 0] } }));
  assert.deepEqual(result, { ok: false, reason: "no-gps" });
});

test("Exifの無いJPEG・JPEGでないファイル・壊れたバイト列", () => {
  const bare = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02]).buffer;
  assert.deepEqual(parseExifGps(bare), { ok: false, reason: "no-gps" });
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).buffer;
  assert.deepEqual(parseExifGps(png), { ok: false, reason: "not-jpeg" });
  // APP1の長さがファイルの外を指していても例外にしない
  const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45]).buffer;
  assert.equal(parseExifGps(broken).ok, false);
  assert.equal(parseExifTakenAt(broken), null);
});

test("位置が入っていないときの断りに、iPhoneのSafariの手がかりを入れる", () => {
  assert.match(photoGpsFailureMessage("no-gps"), /オプション/);
});
