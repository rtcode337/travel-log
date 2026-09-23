/**
 * ZIPファイルをブラウザで開くための最小の読み取り。
 *
 * **生成側(`lib/zip.ts`)とはファイルを分ける。** あちらは訪問記録のエクスポート用で
 * `Buffer`を使うサーバー専用のモジュールなので、同じファイルに置くと画面側の束に
 * サーバー用のコードが混ざる。
 *
 * **ライブラリを足さない。** 展開は標準の`DecompressionStream("deflate-raw")`が
 * やってくれるので、こちらが要るのは**入れ物の読み取り**(どこに何バイトあるか)だけ。
 *
 * **対応しているのは「そのまま(stored)」と「deflate」**の2つ。ZIPの圧縮方式は
 * 他にもあるが、どの書き出しも既定はこの2つで、それ以外で書かれたものは方式の番号を
 * 挙げて断る —— 黙って空のファイルとして通すと、取り込みが「0件」という顔で終わる。
 *
 * **ZIP64は読まない**(4GB超・65,535件超)。踏んだときにそうと分かる文言で断る。
 */

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
/** ZIPの末尾コメントの最大長。EOCDはここより後ろには無い */
const MAX_COMMENT = 0xffff;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** ZIPの中身(書庫の中の相対パス → 中身) */
export type ZipEntries = Map<string, Uint8Array>;

function findEocd(view: DataView): number {
  const min = Math.max(0, view.byteLength - MAX_COMMENT - 22);
  // 末尾から探す(コメントの中に同じ並びが現れることがあるので、後ろほど確からしい)
  for (let at = view.byteLength - 22; at >= min; at--) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at;
  }
  return -1;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // ZIPの中身は生のdeflate(zlibのヘッダが付かない)ので"deflate-raw"
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * ZIPを開いて「パス → 中身」にする。**フォルダの項目は入れない**
 * (名前が`/`で終わるものは中身を持たない)。
 */
export async function readZip(blob: Blob): Promise<ZipEntries> {
  const buffer = await blob.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocd = findEocd(view);
  if (eocd < 0) {
    throw new Error("ZIPファイルとして読めませんでした(末尾の索引が見つかりません)。");
  }
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  if (count === 0xffff || at === 0xffffffff) {
    throw new Error("ZIP64形式のZIPには対応していません(分けて取り込んでください)。");
  }
  const decoder = new TextDecoder();
  const entries: ZipEntries = new Map();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw new Error("ZIPの索引が壊れています。");
    }
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;

    if (view.getUint32(localAt, true) !== LOCAL_SIGNATURE) {
      throw new Error(`ZIPの中身を読めませんでした: ${name}`);
    }
    // 本体の位置は**ローカルヘッダ側の長さ**で決まる(索引側とは別の値が入りうる)
    const dataAt =
      localAt +
      30 +
      view.getUint16(localAt + 26, true) +
      view.getUint16(localAt + 28, true);
    const raw = bytes.subarray(dataAt, dataAt + compressedSize);
    if (method === METHOD_STORED) {
      entries.set(name, raw);
    } else if (method === METHOD_DEFLATE) {
      entries.set(name, await inflate(raw));
    } else {
      throw new Error(
        `ZIPの圧縮方式(${method})に対応していません: ${name}(通常のZIPで作り直してください)。`
      );
    }
  }
  return entries;
}

/** 中身を文字列で取り出す。無ければnull(「無い」と「空」を分けるため) */
export function zipText(entries: ZipEntries, path: string): string | null {
  const data = entries.get(path);
  return data === undefined ? null : new TextDecoder().decode(data);
}

/** travel-log-data形式の1フォルダ(`<キー>/settings.json`がある場所) */
export interface ZipTypeFolder {
  /** 書庫の中での前置き(`"tazuna_meals/"`。書庫の直下なら空文字) */
  prefix: string;
  key: string;
  label: string;
}

/**
 * 書庫の中から、スポット種別のフォルダを見つける。
 *
 * **目印は`settings.json`**(travel-log-dataと同じ形)。書庫の直下に置かれていても、
 * `<キー>/`の下でも、どちらも読める —— 1種別だけを書き出したZIPは前者になりやすい。
 * **キーはsettings.jsonに書いてあるほうを使う**(フォルダ名は書き出す側の都合で
 * 変わりうるが、キーはURLの一部になるので中身のほうが正しい)。
 *
 * **macOSが足す`__MACOSX/`は読み飛ばす**(中身は同じ名前のメタデータで、
 * JSONとして読むと壊れているように見える)。
 */
export function findTypeFolders(entries: ZipEntries): ZipTypeFolder[] {
  const found: ZipTypeFolder[] = [];
  for (const path of entries.keys()) {
    if (path.startsWith("__MACOSX/") || !path.endsWith("settings.json")) continue;
    const prefix = path.slice(0, path.length - "settings.json".length);
    // <キー>/settings.json か settings.json だけを見る(より深い階層は対象外)
    if (prefix.split("/").filter(Boolean).length > 1) continue;
    let json: unknown;
    try {
      json = JSON.parse(zipText(entries, path) ?? "");
    } catch {
      continue;
    }
    const key = (json as { key?: unknown }).key;
    const label = (json as { label?: unknown }).label;
    if (typeof key === "string" && key && typeof label === "string" && label) {
      found.push({ prefix, key, label });
    }
  }
  return found;
}
