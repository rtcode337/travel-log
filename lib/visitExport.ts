import path from "path";
import { query } from "@/lib/db";
import { parseVisitPhotoPath, readVisitPhoto } from "@/lib/photos";
import { buildCsv } from "@/lib/csv";
import { formatCategoryList } from "@/lib/category";
import { buildZip, type ZipEntry } from "@/lib/zip";

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
  type_key: string;
  visited_on: Date | null;
  memo: string | null;
  photos: string[];
  unvisited: boolean;
  name: string;
  name_kana: string | null;
  lat: number;
  lng: number;
  region: string;
  series: string | null;
  categories: string[];
}

const CSV_HEADER = [
  "スポット名",
  "ふりがな",
  "緯度",
  "経度",
  "地域",
  "シリーズ",
  "カテゴリ",
  "訪問日時(JST)",
  "メモ",
  "写真",
  "未訪問記録",
];

export interface VisitExportResult {
  zip: Buffer;
  visitCount: number;
  photoCount: number;
}

export async function buildVisitExportZip(
  userId: string
): Promise<VisitExportResult> {
  const { rows } = await query<ExportRow>(
    `select st.key as type_key,
            v.visited_on, v.memo, v.photos, v.unvisited,
            s.name, s.name_kana, s.lat, s.lng, s.region, s.series, s.categories
     from visits v
     join spots s on s.id = v.spot_id
     join spot_types st on st.id = s.spot_type_id
     where v.user_id = $1
     order by st.key asc, v.visited_on asc nulls last, v.created_at asc`,
    [userId]
  );

  const photoEntries: ZipEntry[] = [];
  // 種別キー → その種別のCSV行(先頭は見出し)
  const csvByType = new Map<string, (string | number | null)[][]>();

  for (const row of rows) {
    // 実際に読めた写真だけをZIPに入れ、CSVにもそれだけを載せる
    // (ファイル欠損でエクスポート全体を失敗させない)。ファイル名は保存時のUUIDの
    // ため、種別をまたいでphotos/直下に平坦化しても衝突しない
    const zipPaths: string[] = [];
    for (const relPath of row.photos) {
      const parsed = parseVisitPhotoPath(relPath);
      if (!parsed || parsed.userId !== userId) continue;
      const data = await readVisitPhoto(parsed.relPath);
      if (!data) continue; // 欠損はスキップ
      const zipPath = `photos/${path.posix.basename(relPath)}`;
      photoEntries.push({ name: zipPath, data: Buffer.from(data) });
      zipPaths.push(zipPath);
    }

    const csvRows = csvByType.get(row.type_key) ?? [CSV_HEADER];
    csvRows.push([
      row.name,
      row.name_kana,
      row.lat,
      row.lng,
      row.region,
      row.series,
      // 複数カテゴリはインポート側のCSVと同じくパイプ区切りの1列にまとめる
      formatCategoryList(row.categories),
      formatVisitedAtJst(row.visited_on),
      row.memo,
      zipPaths.join(";"),
      // 未訪問記録(訪問済みに数えない記録)は「未訪問」、通常の訪問記録は空欄
      row.unvisited ? "未訪問" : "",
    ]);
    csvByType.set(row.type_key, csvRows);
  }

  const csvEntries: ZipEntry[] = [...csvByType.entries()].map(
    ([typeKey, csvRows]) => ({
      name: `visits-${typeKey}.csv`,
      // BOM付きUTF-8(ExcelでのUTF-8自動判別のため)
      data: Buffer.from("\ufeff" + buildCsv(csvRows), "utf8"),
    })
  );
  // 訪問記録が1件も無くても空のZIPを返さず、見出しだけのCSVを1枚入れる
  // (「取り込みに失敗した」のか「記録が無い」のかを開いた人が見分けられるように)
  if (csvEntries.length === 0) {
    csvEntries.push({
      name: "visits.csv",
      data: Buffer.from("\ufeff" + buildCsv([CSV_HEADER]), "utf8"),
    });
  }

  return {
    zip: buildZip([...csvEntries, ...photoEntries]),
    visitCount: rows.length,
    photoCount: photoEntries.length,
  };
}
