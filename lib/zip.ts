/**
 * 依存パッケージなしの最小ZIP生成(サーバー専用モジュール)。
 *
 * 訪問記録エクスポート(app/api/visits/export/route.ts)のためのもので、
 * 圧縮はしない(STORE方式)。同梱するのは圧縮済み画像(jpg/png/webp)と
 * 小さなCSVだけなので、deflateしてもサイズはほぼ変わらない。
 * ZIP64には対応しない(4GB超・65,535エントリ超は生成時にエラーにする)。
 */

export interface ZipEntry {
  /** ZIP内の相対パス(スラッシュ区切り) */
  name: string;
  data: Buffer;
}

// CRC-32(ZIP標準の多項式0xEDB88320)のルックアップテーブル
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** ZIPヘッダーのMS-DOS形式日時(2秒精度・ローカル時刻) */
function dosDateTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date:
      (((d.getFullYear() - 1980) & 0x7f) << 9) |
      ((d.getMonth() + 1) << 5) |
      d.getDate(),
  };
}

export function buildZip(entries: ZipEntry[], mtime = new Date()): Buffer {
  if (entries.length > 0xffff) {
    throw new Error("ZIPに格納できるファイル数の上限を超えました");
  }
  const { time, date } = dosDateTime(mtime);

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);

    // ローカルファイルヘッダー + ファイル名 + データ本体
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // シグネチャ
    local.writeUInt16LE(20, 4); // 展開に必要なバージョン(2.0)
    local.writeUInt16LE(0x0800, 6); // フラグ: ファイル名はUTF-8
    local.writeUInt16LE(0, 8); // 圧縮方式: STORE(無圧縮)
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18); // 圧縮後サイズ(=無圧縮なので同じ)
    local.writeUInt32LE(entry.data.length, 22); // 元サイズ
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // 拡張フィールド長
    localParts.push(local, nameBytes, entry.data);

    // セントラルディレクトリエントリ(未指定オフセットはalloc時の0のまま)
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // シグネチャ
    central.writeUInt16LE(20, 4); // 作成バージョン
    central.writeUInt16LE(20, 6); // 展開に必要なバージョン
    central.writeUInt16LE(0x0800, 8); // フラグ: ファイル名はUTF-8
    central.writeUInt16LE(0, 10); // 圧縮方式: STORE
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42); // 対応するローカルヘッダーの位置
    centralParts.push(central, nameBytes);

    offset += 30 + nameBytes.length + entry.data.length;
    if (offset > 0xffffffff) {
      throw new Error("ZIPのサイズ上限(4GB)を超えました");
    }
  }

  const centralSize = centralParts.reduce((n, b) => n + b.length, 0);

  // セントラルディレクトリ終端レコード
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // シグネチャ
  eocd.writeUInt16LE(entries.length, 8); // このディスク上のエントリ数
  eocd.writeUInt16LE(entries.length, 10); // 総エントリ数
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16); // セントラルディレクトリの開始位置
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}
