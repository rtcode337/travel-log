import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { parseVisitPhotoPath } from "@/lib/photos";
import { buildCsv } from "@/lib/csv";
import { buildZip, type ZipEntry } from "@/lib/zip";
import { DATE_PRECISIONS, type DatePrecision } from "@/lib/types";

interface ExportRow {
  visited_on: string | null;
  date_precision: DatePrecision;
  memo: string | null;
  photos: string[];
  spot_type_label: string;
  name: string;
  name_kana: string | null;
  region: string;
  lat: number;
  lng: number;
  rank: string | null;
  category: string | null;
}

const PRECISION_LABELS = Object.fromEntries(
  DATE_PRECISIONS.map((p) => [p.value, p.label])
);

/**
 * 自分の訪問記録をZIPでエクスポートする(アカウント画面のボタンから)。
 * 既定は全スポット種別分で、`?type=<種別キー>`を付けるとその種別の記録だけに絞る。
 * ZIPの中身は visits.csv(訪問のメモ+スポット情報)と photos/(その訪問記録に
 * 添付した写真。ファイル名は保存時のUUIDのまま)で、CSVの「写真」列がZIP内の
 * 写真パスを指す。写真と同様に本人の記録しか含まれない(user_idで絞り込み、
 * 写真ファイルもパスの所有者チェックを通ったものだけ読む)。
 */
export async function GET(request: Request) {
  const userId = await getCurrentUserId();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 種別の絞り込みは訪問記録の有無に関わらずキーの実在だけ確認する
  // (打ち間違いを空ZIPの正常終了として返さないため)
  const typeKey = new URL(request.url).searchParams.get("type");
  if (typeKey) {
    const { rows } = await query("select 1 from spot_types where key = $1", [
      typeKey,
    ]);
    if (rows.length === 0) {
      return NextResponse.json({ error: "spot type not found" }, { status: 404 });
    }
  }

  // lib/db.tsでdate型は"YYYY-MM-DD"文字列のまま返る
  const { rows } = await query<ExportRow>(
    `select v.visited_on, v.date_precision, v.memo, v.photos,
            st.label as spot_type_label,
            s.name, s.name_kana, s.region, s.lat, s.lng, s.rank, s.category
     from visits v
     join spots s on s.id = v.spot_id
     join spot_types st on st.id = s.spot_type_id
     where v.user_id = $1 and ($2::text is null or st.key = $2)
     order by v.visited_on asc nulls last, v.created_at asc`,
    [userId, typeKey]
  );

  const photoEntries: ZipEntry[] = [];
  const csvRows: (string | number | null)[][] = [
    [
      "スポット種別",
      "スポット名",
      "ふりがな",
      "地域",
      "緯度",
      "経度",
      "ランク",
      "カテゴリ",
      "訪問日",
      "訪問日の精度",
      "メモ",
      "写真",
    ],
  ];

  for (const row of rows) {
    // 実際に読めた写真だけをZIPに入れ、CSVにもそれだけを載せる
    // (ファイル欠損でエクスポート全体を失敗させない)。ファイル名は
    // 保存時のUUIDのため、フォルダをphotos/直下に平坦化しても衝突しない
    const zipPaths: string[] = [];
    for (const relPath of row.photos) {
      const parsed = parseVisitPhotoPath(relPath);
      if (!parsed || parsed.userId !== userId) continue;
      try {
        const data = await fs.readFile(parsed.absPath);
        const zipPath = `photos/${path.posix.basename(relPath)}`;
        photoEntries.push({ name: zipPath, data });
        zipPaths.push(zipPath);
      } catch {
        // 欠損ファイルはスキップ
      }
    }
    csvRows.push([
      row.spot_type_label,
      row.name,
      row.name_kana,
      row.region,
      row.lat,
      row.lng,
      row.rank,
      row.category,
      row.visited_on,
      PRECISION_LABELS[row.date_precision] ?? row.date_precision,
      row.memo,
      zipPaths.join(";"),
    ]);
  }

  // BOM付きUTF-8(ExcelでのUTF-8自動判別のため)
  const csv = Buffer.from("\ufeff" + buildCsv(csvRows), "utf8");
  const zip = buildZip([{ name: "visits.csv", data: csv }, ...photoEntries]);

  // ファイル名の日付はJST
  const jstDate = new Date(Date.now() + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");

  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="travel-log-visits-${
        typeKey ? `${typeKey}-` : ""
      }${jstDate}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
