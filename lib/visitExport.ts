import path from "path";
import { query } from "@/lib/db";
import { parseVisitPhotoPath, readVisitPhoto } from "@/lib/photos";
import { buildCsv } from "@/lib/csv";
import { formatCategoryList } from "@/lib/category";
import type { ZipWriter } from "@/lib/zip";
import { buildVisitCsvRow, VISIT_CSV_HEADER } from "@/lib/visitExportCsv";

/**
 * 1ユーザーの訪問記録+写真をZIPにまとめる(サーバー専用モジュール)。
 *
 * **スポット種別をまたいで全部を1つのZIPに入れる**(種別ごとに
 * `visits-<種別キー>.csv`、写真は共通の `photos/`)。管理者が人ごとに1回
 * 実行すれば済むようにするため。CSVの「写真」列がZIP内の写真パスを指す。
 *
 * かつては `GET /api/visits/export?type=` が本人向けにその場で組んで返していたが、
 * 写真ごとZIPにする処理は重く、実行を管理者に限ってバックグラウンドで作る形に変えた
 * (結果は export_jobs 経由でダウンロードする)。
 */

/** JSTの「YYYY-MM-DD HH:mm」。timestamptzはpgがDateオブジェクトにパースして返す */
function formatVisitedAtJst(visitedOn: Date | null): string {
  if (!visitedOn) return "";
  const jst = new Date(visitedOn.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())}` +
    ` ${p(jst.getUTCHours())}:${p(jst.getUTCMinutes())}`
  );
}

interface ExportRow {
  id: string;
  type_key: string;
  visited_on: Date | null;
  memo: string | null;
  photos: string[];
  unvisited: boolean;
  place_lat: number | null;
  place_lng: number | null;
  name: string;
  name_kana: string | null;
  lat: number;
  lng: number;
  region: string;
  series: string | null;
  categories: string[];
}

interface VisitExportResult {
  visitCount: number;
  photoCount: number;
}

/**
 * `zip`へ1件ずつ書き足す。**写真は1枚読んではすぐ書く**(全部をメモリに溜めない)。
 * CSVは写真の欠損を反映してから組むので、ZIPの最後に入れる
 */
export async function writeVisitExport(
  userId: string,
  zip: ZipWriter
): Promise<VisitExportResult> {
  const { rows } = await query<ExportRow>(
    `select v.id,
            st.key as type_key,
            v.visited_on, v.memo, v.photos, v.unvisited, v.place_lat, v.place_lng,
            s.name, s.name_kana, s.lat, s.lng, s.region, s.series, s.categories
     from visits v
     join spots s on s.id = v.spot_id
     join spot_types st on st.id = s.spot_type_id
     where v.user_id = $1
     order by st.key asc, v.visited_on asc nulls last, v.created_at asc`,
    [userId]
  );

  // 訪問記録への追記。訪問記録と同じZIPに入れないと、追記に付けた写真だけが
  // 手元に残らない —— エクスポートは記録の持ち出しなので、抜けがあってはいけない
  const { rows: noteRows } = await query<{
    visit_id: string;
    body: string | null;
    photos: string[];
    created_at: Date;
  }>(
    `select n.visit_id, n.body, n.photos, n.created_at
       from visit_notes n
       join visits v on v.id = n.visit_id
      where v.user_id = $1
      order by n.created_at asc`,
    [userId]
  );
  const notesByVisit = new Map<string, typeof noteRows>();
  for (const note of noteRows) {
    const list = notesByVisit.get(note.visit_id);
    if (list) list.push(note);
    else notesByVisit.set(note.visit_id, [note]);
  }

  let photoCount = 0;
  // 種別キー → その種別のCSV行(先頭は見出し)
  const csvByType = new Map<string, (string | number | null)[][]>();

  for (const row of rows) {
    // 実際に読めた写真だけをZIPに入れ、CSVにもそれだけを載せる
    // (ファイル欠損でエクスポート全体を失敗させない)。ファイル名は保存時のUUIDの
    // ため、種別をまたいでphotos/直下に平坦化しても衝突しない
    const notes = notesByVisit.get(row.id) ?? [];
    const zipPaths: string[] = [];
    // 追記の写真は元の記録の写真の後ろに続ける(画面の並びと同じ)
    for (const relPath of [...row.photos, ...notes.flatMap((n) => n.photos)]) {
      const parsed = parseVisitPhotoPath(relPath);
      if (!parsed || parsed.userId !== userId) continue;
      const data = await readVisitPhoto(parsed.relPath);
      if (!data) continue; // 欠損はスキップ
      const zipPath = `photos/${path.posix.basename(relPath)}`;
      await zip.add(zipPath, Buffer.from(data));
      photoCount++;
      zipPaths.push(zipPath);
    }

    const csvRows = csvByType.get(row.type_key) ?? [[...VISIT_CSV_HEADER]];
    // 列の並びと読み戻しは lib/visitExportCsv.ts(列は末尾にしか足さない)
    csvRows.push(
      buildVisitCsvRow({
        name: row.name,
        nameKana: row.name_kana,
        lat: row.lat,
        lng: row.lng,
        region: row.region,
        series: row.series,
        // 複数カテゴリはインポート側のCSVと同じくパイプ区切りの1列にまとめる
        categories: formatCategoryList(row.categories),
        visitedAt: formatVisitedAtJst(row.visited_on),
        memo: row.memo,
        notes: notes
          .map(
            (n) => `${formatVisitedAtJst(n.created_at)} ${n.body ?? ""}`.trimEnd()
          )
          .join("\n"),
        photos: zipPaths.join(";"),
        unvisited: row.unvisited,
        placeLat: row.place_lat,
        placeLng: row.place_lng,
      })
    );
    csvByType.set(row.type_key, csvRows);
  }

  // BOM付きUTF-8(ExcelでのUTF-8自動判別のため)
  const csvData = (csvRows: (string | number | null)[][]) =>
    Buffer.from("\ufeff" + buildCsv(csvRows), "utf8");
  for (const [typeKey, csvRows] of csvByType) {
    await zip.add(`visits-${typeKey}.csv`, csvData(csvRows));
  }
  // 訪問記録が1件も無くても空のZIPを返さず、見出しだけのCSVを1枚入れる
  // (「取り込みに失敗した」のか「記録が無い」のかを開いた人が見分けられるように)
  if (csvByType.size === 0) {
    await zip.add("visits.csv", csvData([[...VISIT_CSV_HEADER]]));
  }

  return { visitCount: rows.length, photoCount };
}
