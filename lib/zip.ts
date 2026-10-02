/**
 * 依存パッケージなしの最小ZIP生成(サーバー専用モジュール)。
 *
 * 訪問記録エクスポート(lib/visitExport.ts。POST /api/exportsのバックグラウンド生成)のためのもので、
 * **1件ずつ書き出す**(全体をメモリに組まない)。写真の多いユーザーでは ZIP が数百MBになり、
 * まとめて組むとプロセスごと落ちうるため。圧縮はしない(STORE方式)。同梱するのは圧縮済み画像(jpg/png/webp)と
 * 小さなCSVだけなので、deflateしてもサイズはほぼ変わらない。
 * ZIP64には対応しない(4GB超・65,535エントリ超は生成時にエラーにする)。
 */

// CRC-32(ZIP標準の多項式0xEDB88320)のルックアップテーブル
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

function crc32(data: Uint8Array): number {
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

/**
 * ZIPを先頭から順に書き出す。`add`のたびにローカルヘッダーと中身を`write`へ渡し、
 * セントラルディレクトリ(各エントリの位置の一覧)だけを手元に持って`finish`で書く。
 * 持つのはエントリ1件につき数十バイトなので、写真が何千枚あっても軽い。
 */
export class ZipWriter {
  private readonly central: Buffer[] = [];
  private offset = 0;
  private count = 0;
  private readonly time: number;
  private readonly date: number;

  constructor(private readonly write: (chunk: Buffer) => Promise<void>) {
    ({ time: this.time, date: this.date } = dosDateTime(new Date()));
  }

  /** エントリ数 */
  get size(): number {
    return this.count;
  }

  async add(name: string, data: Buffer): Promise<void> {
    if (this.count >= 0xffff) {
      throw new Error("ZIPに格納できるファイル数の上限を超えました");
    }
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    if (this.offset + 30 + nameBytes.length + data.length > 0xffffffff) {
      throw new Error("ZIPのサイズ上限(4GB)を超えました");
    }

    // ローカルファイルヘッダー + ファイル名 + データ本体
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // シグネチャ
    local.writeUInt16LE(20, 4); // 展開に必要なバージョン(2.0)
    local.writeUInt16LE(0x0800, 6); // フラグ: ファイル名はUTF-8
    local.writeUInt16LE(0, 8); // 圧縮方式: STORE(無圧縮)
    local.writeUInt16LE(this.time, 10);
    local.writeUInt16LE(this.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // 圧縮後サイズ(=無圧縮なので同じ)
    local.writeUInt32LE(data.length, 22); // 元サイズ
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // 拡張フィールド長
    await this.write(Buffer.concat([local, nameBytes]));
    await this.write(data);

    // セントラルディレクトリエントリ(未指定オフセットはalloc時の0のまま)
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // シグネチャ
    central.writeUInt16LE(20, 4); // 作成バージョン
    central.writeUInt16LE(20, 6); // 展開に必要なバージョン
    central.writeUInt16LE(0x0800, 8); // フラグ: ファイル名はUTF-8
    central.writeUInt16LE(0, 10); // 圧縮方式: STORE
    central.writeUInt16LE(this.time, 12);
    central.writeUInt16LE(this.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(this.offset, 42); // 対応するローカルヘッダーの位置
    this.central.push(central, nameBytes);

    this.offset += 30 + nameBytes.length + data.length;
    this.count++;
  }

  /** セントラルディレクトリと終端レコードを書き、ZIP全体のバイト数を返す */
  async finish(): Promise<number> {
    const centralDir = Buffer.concat(this.central);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); // シグネチャ
    eocd.writeUInt16LE(this.count, 8); // このディスク上のエントリ数
    eocd.writeUInt16LE(this.count, 10); // 総エントリ数
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(this.offset, 16); // セントラルディレクトリの開始位置
    await this.write(centralDir);
    await this.write(eocd);
    return this.offset + centralDir.length + eocd.length;
  }
}
