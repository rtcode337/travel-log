/**
 * JPEGのExif(APP1)から撮影日時だけを取り出す最小実装。
 *
 * 訪問記録の「写真の撮影日時を訪問日時にする」ボタンのためだけに使うため、
 * 汎用のExifライブラリは入れず(依存を増やさない方針。`lib/zip.ts`と同様)、
 * DateTimeOriginal(0x9003)と、無い場合のフォールバックのDateTime(0x0132)の
 * 2タグだけを読む。Exifが無い・壊れている・HEIC等のJPEG以外は常にnullを返す。
 */

/** Exifは通常ファイル先頭付近にあるため、この長さだけ読めば足りる */
const EXIF_SCAN_BYTES = 256 * 1024;

const TAG_DATETIME = 0x0132; // IFD0: ファイルの更新日時(カメラでは撮影日時と同じことが多い)
const TAG_EXIF_IFD_POINTER = 0x8769; // IFD0: Exif SubIFDへのオフセット
const TAG_DATETIME_ORIGINAL = 0x9003; // Exif SubIFD: 撮影日時

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

/** 1つのIFDを走査し、欲しいタグの値(ASCII文字列 or LONG)を集める */
function readIfd(
  view: DataView,
  tiffStart: number,
  ifdOffset: number,
  little: boolean,
  wanted: Set<number>
): Map<number, { ascii: string; long: number }> {
  const found = new Map<number, { ascii: string; long: number }>();
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
    let ascii = "";
    let long = 0;
    if (type === 2) {
      // ASCII: 4バイトを超える値は本体がオフセット先にある
      const valueOffset =
        valueCount <= 4 ? entry + 8 : tiffStart + view.getUint32(entry + 8, little);
      if (valueOffset >= 0 && valueOffset + valueCount <= view.byteLength) {
        ascii = readAscii(view, valueOffset, valueCount);
      }
    } else if (type === 4) {
      long = view.getUint32(entry + 8, little);
    }
    found.set(tag, { ascii, long });
  }
  return found;
}

function findDateTimeInExif(buffer: ArrayBuffer, tiffStart: number): Date | null {
  const view = new DataView(buffer);
  if (tiffStart + 8 > view.byteLength) return null;

  const byteOrder = view.getUint16(tiffStart, false);
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return null; // "II" / "MM"
  const little = byteOrder === 0x4949;
  if (view.getUint16(tiffStart + 2, little) !== 0x2a) return null;

  const ifd0Offset = view.getUint32(tiffStart + 4, little);
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

/**
 * 画像ファイルの撮影日時(Exif)を返す。取得できなければnull。
 * 読み取りに失敗しても例外は投げない(ボタンを出さないだけ)。
 */
export async function readPhotoTakenAt(file: File): Promise<Date | null> {
  try {
    const buffer = await file.slice(0, EXIF_SCAN_BYTES).arrayBuffer();
    const view = new DataView(buffer);
    const tiffStart = findExifTiffStart(view);
    if (tiffStart === null) return null;
    return findDateTimeInExif(buffer, tiffStart);
  } catch {
    return null;
  }
}
