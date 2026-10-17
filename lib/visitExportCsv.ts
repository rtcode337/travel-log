/**
 * 訪問記録エクスポート(ZIP)の`visits-<種別キー>.csv`の列の定義と、1行の組み立て・読み戻し。
 * DBにもファイルにも触らない純粋な関数だけを置く(`lib/visitExport.ts`が使い、
 * `lib/visitExportCsv.test.ts`が検査する)。
 *
 * **列は末尾にしか足さない。** 書き出したZIPは利用者の手元に残り、あとで読み戻される
 * (表計算ソフトで開く・別の道具に取り込む)ので、既存の列の位置や意味を変えると
 * 古いファイルと新しいファイルで同じ列名が別のものを指すことになる。
 * 「緯度」「経度」は**スポットの位置のまま**で、訪問記録の「行った場所」は末尾の
 * 「行った場所の緯度」「行った場所の経度」に入れる(指していない記録は空欄)。
 * 読み戻しは列名で引き、無い列(古いファイル)は空として扱う。
 */

export const VISIT_CSV_HEADER = [
  "スポット名",
  "ふりがな",
  "緯度",
  "経度",
  "地域",
  "シリーズ",
  "カテゴリ",
  "訪問日時(JST)",
  "メモ",
  // 追記(visit_notes)は訪問記録にぶら下がるので行を増やさず、1列にまとめる
  // (「<追記日時> <本文>」を改行区切り)。写真は元の記録の写真の後ろに続ける
  "追記",
  "写真",
  "未訪問記録",
  // 「行った場所」(スポットのピンとは別の、実際に行った位置)。後から足した列なので末尾
  "行った場所の緯度",
  "行った場所の経度",
] as const;

export interface VisitCsvRecord {
  name: string;
  nameKana: string | null;
  lat: number;
  lng: number;
  region: string;
  series: string | null;
  /** パイプ区切りの1列にまとめたカテゴリ */
  categories: string;
  /** JSTの「YYYY-MM-DD HH:mm」(時期不明は空) */
  visitedAt: string;
  memo: string | null;
  notes: string;
  /** ZIP内の写真パス(`;`区切り) */
  photos: string;
  unvisited: boolean;
  placeLat: number | null;
  placeLng: number | null;
}

/** 1件ぶんの行(`VISIT_CSV_HEADER`と同じ並び) */
export function buildVisitCsvRow(r: VisitCsvRecord): (string | number | null)[] {
  return [
    r.name,
    r.nameKana,
    r.lat,
    r.lng,
    r.region,
    r.series,
    r.categories,
    r.visitedAt,
    r.memo,
    r.notes,
    r.photos,
    // 未訪問記録(訪問済みに数えない記録)は「未訪問」、通常の訪問記録は空欄
    r.unvisited ? "未訪問" : "",
    r.placeLat,
    r.placeLng,
  ];
}

function toNumberOrNull(value: string | undefined): number | null {
  if (value == null || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * 書き出したCSV(見出し行つき、`parseCsv`で読んだもの)を読み戻す。
 * **列名で引く**ので、列が足りない古いファイルも読める(無い列は空)。
 * 先頭のBOMは見出しの1列目に付いて残るので落とす
 */
export function parseVisitCsv(rows: string[][]): VisitCsvRecord[] {
  if (rows.length === 0) return [];
  const header = rows[0].map((h, i) => (i === 0 ? h.replace(/^﻿/, "") : h));
  const col = (name: (typeof VISIT_CSV_HEADER)[number]) => header.indexOf(name);
  const idx = Object.fromEntries(VISIT_CSV_HEADER.map((name) => [name, col(name)])) as Record<
    (typeof VISIT_CSV_HEADER)[number],
    number
  >;
  const get = (row: string[], name: (typeof VISIT_CSV_HEADER)[number]) =>
    idx[name] >= 0 ? row[idx[name]] : undefined;
  return rows
    .slice(1)
    .filter((row) => row.some((cell) => cell !== ""))
    .map((row) => {
      const placeLat = toNumberOrNull(get(row, "行った場所の緯度"));
      const placeLng = toNumberOrNull(get(row, "行った場所の経度"));
      // 片方だけの行は「指していない」として読む(DBと同じく片方だけの状態は持たない)
      const hasPlace = placeLat !== null && placeLng !== null;
      return {
        name: get(row, "スポット名") ?? "",
        nameKana: get(row, "ふりがな") || null,
        lat: toNumberOrNull(get(row, "緯度")) ?? Number.NaN,
        lng: toNumberOrNull(get(row, "経度")) ?? Number.NaN,
        region: get(row, "地域") ?? "",
        series: get(row, "シリーズ") || null,
        categories: get(row, "カテゴリ") ?? "",
        visitedAt: get(row, "訪問日時(JST)") ?? "",
        memo: get(row, "メモ") || null,
        notes: get(row, "追記") ?? "",
        photos: get(row, "写真") ?? "",
        unvisited: get(row, "未訪問記録") === "未訪問",
        placeLat: hasPlace ? placeLat : null,
        placeLng: hasPlace ? placeLng : null,
      };
    });
}

/** 訪問の位置(行った場所があればそちら、無ければスポットの位置) */
export function visitCsvPosition(r: VisitCsvRecord): { lat: number; lng: number } {
  return r.placeLat !== null && r.placeLng !== null
    ? { lat: r.placeLat, lng: r.placeLng }
    : { lat: r.lat, lng: r.lng };
}
