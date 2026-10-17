/**
 * JPEGのExif(APP1)から撮影日時と撮影地(GPS)だけを取り出す最小実装。
 *
 * 訪問記録の「写真の撮影日時を訪問日時にする」と、座標を指す画面の「写真の位置を使う」の
 * ためだけに使うため、汎用のExifライブラリは入れず(依存を増やさない方針。`lib/zip.ts`と同様)、
 * 読むタグを絞ってある:
 *
 * - 撮影日時: DateTimeOriginal(0x9003)と、無い場合のフォールバックのDateTime(0x0132)
 * - 撮影地: GPSInfo IFD(0x8825が指す先)の緯度・経度(度分秒の3つの有理数)とN/S・E/W
 *
 * Exifが無い・壊れている・HEIC等のJPEG以外では値を返さず、例外も投げない。
 * 読み取りの本体はバイト列(ArrayBuffer)を受ける関数にしてあり、テストからはそちらを呼ぶ
 * (`lib/exif.test.ts`。Fileを経由しないので、組み立てたバイト列でそのまま検査できる)。
 */

/** Exifは通常ファイル先頭付近にあるため、この長さだけ読めば足りる */
const EXIF_SCAN_BYTES = 256 * 1024;

const TAG_DATETIME = 0x0132; // IFD0: ファイルの更新日時(カメラでは撮影日時と同じことが多い)
const TAG_EXIF_IFD_POINTER = 0x8769; // IFD0: Exif SubIFDへのオフセット
const TAG_GPS_IFD_POINTER = 0x8825; // IFD0: GPSInfo IFDへのオフセット
const TAG_DATETIME_ORIGINAL = 0x9003; // Exif SubIFD: 撮影日時
const TAG_GPS_LATITUDE_REF = 0x0001; // GPS IFD: "N" / "S"
const TAG_GPS_LATITUDE = 0x0002; // GPS IFD: 度・分・秒(RATIONAL×3)
const TAG_GPS_LONGITUDE_REF = 0x0003; // GPS IFD: "E" / "W"
const TAG_GPS_LONGITUDE = 0x0004; // GPS IFD: 度・分・秒(RATIONAL×3)

const TYPE_ASCII = 2;
const TYPE_SHORT = 3;
const TYPE_LONG = 4;
const TYPE_RATIONAL = 5;

/**
 * `"YYYY:MM:DD HH:MM:SS"`(Exifの日時形式)をローカル時刻のDateにする。
 * Exifの日時にタイムゾーン情報は無く、撮影地のローカル時刻がそのまま入っている
 * ため、閲覧中の端末のローカル時刻として解釈する(訪問日時欄のdatetime-localと
 * 同じ扱いになる)。
 */
function parseExifDateTime(value: string): Date | null {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const [, year, month, day, hour, minute, second] = m.map(Number);
  const date = new Date(year, month - 1, day, hour, minute, second);
  if (Number.isNaN(date.getTime())) return null;
  // 日付として存在しない値(2026:02:31など)がDateに丸められていないか確認する
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function readAscii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    const code = view.getUint8(offset + i);
    if (code === 0) break;
    out += String.fromCharCode(code);
  }
  return out;
}

interface IfdValue {
  ascii: string;
  /** LONG・SHORTの値(1個目) */
  long: number;
  /** RATIONALの値の並び(分母が0のものはNaN) */
  rationals: number[];
}

/** 1つのIFDを走査し、欲しいタグの値(ASCII文字列・LONG/SHORT・RATIONALの並び)を集める */
function readIfd(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  little: boolean,
  wanted: Set<number>
): Map<number, IfdValue> {
  const found = new Map<number, IfdValue>();
  const base = tiffStart + ifdOffset;
  if (base + 2 > view.byteLength) return found;
  const count = view.getUint16(base, little);
  for (let i = 0; i < count; i++) {
    const entry = base + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, little);
    if (!wanted.has(tag)) continue;
    const type = view.getUint16(entry + 2, little);
    const valueCount = view.getUint32(entry + 4, little);
    const value: IfdValue = { ascii: "", long: 0, rationals: [] };
    if (type === TYPE_ASCII) {
      // ASCII: 4バイトを超える値は本体がオフセット先にある
      const valueOffset =
        valueCount <= 4 ? entry + 8 : tiffStart + view.getUint32(entry + 8, little);
      if (valueOffset >= 0 && valueOffset + valueCount <= view.byteLength) {
        value.ascii = readAscii(view, valueOffset, valueCount);
      }
    } else if (type === TYPE_LONG) {
      value.long = view.getUint32(entry + 8, little);
    } else if (type === TYPE_SHORT) {
      value.long = view.getUint16(entry + 8, little);
    } else if (type === TYPE_RATIONAL) {
      // RATIONAL(分子・分母のLONG 2つ=8バイト)は1個でも4バイトを超えるので、常にオフセット先
      const valueOffset = tiffStart + view.getUint32(entry + 8, little);
      if (valueCount <= 16 && valueOffset >= 0 && valueOffset + valueCount * 8 <= view.byteLength) {
        for (let k = 0; k < valueCount; k++) {
          const num = view.getUint32(valueOffset + k * 8, little);
          const den = view.getUint32(valueOffset + k * 8 + 4, little);
          value.rationals.push(den === 0 ? Number.NaN : num / den);
        }
      }
    }
    found.set(tag, value);
  }
  return found;
}

/** TIFFヘッダ(バイト順・IFD0の位置)を読む。Exifとして読めなければnull */
function readTiffHeader(
  view: DataView,
  tiffStart: number
): { little: boolean; ifd0Offset: number } | null {
  if (tiffStart + 8 > view.byteLength) return null;
  const byteOrder = view.getUint16(tiffStart, false);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null; // "II" / "MM"
  const little = byteOrder === 0x4949;
  if (view.getUint16(tiffStart + 2, little) !== 0x2a) return null;
  return { little, ifd0Offset: view.getUint32(tiffStart + 4, little) };
}

function findDateTimeInExif(view: DataView, tiffStart: number): Date | null {
  const header = readTiffHeader(view, tiffStart);
  if (!header) return null;
  const { little, ifd0Offset } = header;
  const ifd0 = readIfd(
    view,
    tiffStart,
    ifd0Offset,
    little,
    new Set([TAG_DATETIME, TAG_EXIF_IFD_POINTER])
  );

  const exifIfdOffset = ifd0.get(TAG_EXIF_IFD_POINTER)?.long;
  if (exifIfdOffset) {
    const sub = readIfd(
      view,
      tiffStart,
      exifIfdOffset,
      little,
      new Set([TAG_DATETIME_ORIGINAL])
    );
    const original = sub.get(TAG_DATETIME_ORIGINAL)?.ascii;
    if (original) {
      const parsed = parseExifDateTime(original);
      if (parsed) return parsed;
    }
  }

  const fallback = ifd0.get(TAG_DATETIME)?.ascii;
  return fallback ? parseExifDateTime(fallback) : null;
}

/** 度・分・秒の3つ組を度にする。読めない値(分母0・欠け)ならnull */
function dmsToDegrees(dms: number[]): number | null {
  if (dms.length < 1 || dms.some((v) => !Number.isFinite(v))) return null;
  const [deg, min = 0, sec = 0] = dms;
  return deg + min / 60 + sec / 3600;
}

function findGpsInExif(
  view: DataView,
  tiffStart: number
): { lat: number; lng: number } | null {
  const header = readTiffHeader(view, tiffStart);
  if (!header) return null;
  const { little, ifd0Offset } = header;
  const ifd0 = readIfd(view, tiffStart, ifd0Offset, little, new Set([TAG_GPS_IFD_POINTER]));
  const gpsOffset = ifd0.get(TAG_GPS_IFD_POINTER)?.long;
  if (!gpsOffset) return null;
  const gps = readIfd(
    view,
    tiffStart,
    gpsOffset,
    little,
    new Set([TAG_GPS_LATITUDE_REF, TAG_GPS_LATITUDE, TAG_GPS_LONGITUDE_REF, TAG_GPS_LONGITUDE])
  );
  const lat = dmsToDegrees(gps.get(TAG_GPS_LATITUDE)?.rationals ?? []);
  const lng = dmsToDegrees(gps.get(TAG_GPS_LONGITUDE)?.rationals ?? []);
  if (lat === null || lng === null) return null;
  // 南緯・西経は負にする。参照の欠けた写真は北緯・東経として読む(撮影地の多くがそちら)
  const latRef = gps.get(TAG_GPS_LATITUDE_REF)?.ascii.trim().toUpperCase();
  const lngRef = gps.get(TAG_GPS_LONGITUDE_REF)?.ascii.trim().toUpperCase();
  const signedLat = latRef === "S" ? -lat : lat;
  const signedLng = lngRef === "W" ? -lng : lng;
  if (Math.abs(signedLat) > 90 || Math.abs(signedLng) > 180) return null;
  // **(0, 0)は「測位できなかった」の印として書く機器がある**ので、位置としては扱わない
  // (ギニア湾の沖にピンが飛ぶだけで、訪問の場所になることはまず無い)
  if (signedLat === 0 && signedLng === 0) return null;
  return { lat: signedLat, lng: signedLng };
}

/** JPEGのセグメントを辿ってExif(APP1)のTIFFヘッダ位置を探す */
function findExifTiffStart(view: DataView): number | null {
  if (view.byteLength < 4) return null;
  if (view.getUint16(0, false) !== 0xffd8) return null; // SOI(JPEGでない)

  let offset = 2;
  while (offset + 4 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null; // マーカー境界を見失った
    const marker = view.getUint8(offset + 1);
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) {
      offset += 2; // 長さを持たないマーカー
      continue;
    }
    if (marker === 0xda) return null; // 画像データの開始。ここより後にExifは無い
    const length = view.getUint16(offset + 2, false);
    if (length < 2) return null;
    if (marker === 0xe1 && offset + 4 + 6 <= view.byteLength) {
      // APP1。"Exif\0\0"で始まるものだけがExif(XMPなど別用途のAPP1もある)
      if (readAscii(view, offset + 4, 4) === "Exif") {
        return offset + 10;
      }
    }
    offset += 2 + length;
  }
  return null;
}

function isJpeg(view: DataView): boolean {
  return view.byteLength >= 2 && view.getUint16(0, false) === 0xffd8;
}

/** バイト列(JPEGの先頭部分)から撮影日時を読む。取得できなければnull */
export function parseExifTakenAt(buffer: ArrayBuffer): Date | null {
  try {
    const view = new DataView(buffer);
    const tiffStart = findExifTiffStart(view);
    if (tiffStart === null) return null;
    return findDateTimeInExif(view, tiffStart);
  } catch {
    return null;
  }
}

/**
 * 写真の位置を読んだ結果。読めなかったときは理由を分けて返す
 * (画面の断りの文言を出し分けるため。`not-jpeg`はHEICなど、`no-gps`はExifはあるが
 * 位置が入っていない・消されている、`unreadable`はファイル自体が読めない)
 */
export type PhotoGpsResult =
  | { ok: true; lat: number; lng: number }
  | { ok: false; reason: "not-jpeg" | "no-gps" | "unreadable" };

/** バイト列(JPEGの先頭部分)から撮影地(GPS)を読む */
export function parseExifGps(buffer: ArrayBuffer): PhotoGpsResult {
  try {
    const view = new DataView(buffer);
    if (!isJpeg(view)) return { ok: false, reason: "not-jpeg" };
    const tiffStart = findExifTiffStart(view);
    if (tiffStart === null) return { ok: false, reason: "no-gps" };
    const gps = findGpsInExif(view, tiffStart);
    return gps ? { ok: true, ...gps } : { ok: false, reason: "no-gps" };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/**
 * 画像ファイルの撮影日時(Exif)を返す。取得できなければnull。
 * 読み取りに失敗しても例外は投げない(ボタンを出さないだけ)。
 */
export async function readPhotoTakenAt(file: File): Promise<Date | null> {
  try {
    return parseExifTakenAt(await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer());
  } catch {
    return null;
  }
}

/** 画像ファイルの撮影地(GPS)を返す。例外は投げない(理由つきの失敗で返す) */
export async function readPhotoGps(file: File): Promise<PhotoGpsResult> {
  try {
    return parseExifGps(await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer());
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

/**
 * 位置を読めなかったときの断り(座標を指す画面の「写真の位置を使う」で共用する)。
 * **iPhoneのSafariは写真を渡すときに位置情報を消すことがある**(写真の選択画面の
 * 「オプション」で位置情報を含めるかを選ぶ)ので、入っていなかったときはその手がかりを添える
 */
export function photoGpsFailureMessage(
  reason: "not-jpeg" | "no-gps" | "unreadable"
): string {
  switch (reason) {
    case "not-jpeg":
      return "この形式の写真からは位置を読めません(読めるのはJPEGだけです)。";
    case "unreadable":
      return "写真を読み込めませんでした。";
    default:
      return "この写真には位置情報が入っていませんでした。iPhoneのSafariでは、写真を選ぶ画面の「オプション」で位置情報を含めると読めます。";
  }
}
