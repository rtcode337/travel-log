import { NextResponse } from "next/server";
import path from "path";
import { query } from "@/lib/db";
import { getCurrentUserId } from "@/lib/auth/current-user";
import { parseVisitPhotoPath, readVisitPhoto } from "@/lib/photos";
import { buildCsv } from "@/lib/csv";
import { formatCategoryList } from "@/lib/category";
import { buildZip, type ZipEntry } from "@/lib/zip";

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
  visited_on: Date | null;
  memo: string | null;
  photos: string[];
  name: string;
  name_kana: string | null;
  lat: number;
  lng: number;
  region: string;
  series: string | null;
  categories: string[];
}

/**
 * 自分の訪問記録を、`?type=<種別キー>`のスポット種別分だけZIPでエクスポートする
 * (`/[type]/spots`の「最近の訪問場所」右のボタンから。種別横断のエクスポートは持たない)。
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

  const typeKey = new URL(request.url).searchParams.get("type");
  if (!typeKey) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }
  // 訪問記録の有無に関わらずキーの実在を確認する
  // (打ち間違いを空ZIPの正常終了として返さないため)
  const { rows: typeRows } = await query(
    "select 1 from spot_types where key = $1",
    [typeKey]
  );
  if (typeRows.length === 0) {
    return NextResponse.json({ error: "spot type not found" }, { status: 404 });
  }

  const { rows } = await query<ExportRow>(
    `select v.visited_on, v.memo, v.photos,
            s.name, s.name_kana, s.lat, s.lng, s.region, s.series, s.categories
     from visits v
     join spots s on s.id = v.spot_id
     join spot_types st on st.id = s.spot_type_id
     where v.user_id = $1 and st.key = $2
     order by v.visited_on asc nulls last, v.created_at asc`,
    [userId, typeKey]
  );

  const photoEntries: ZipEntry[] = [];
  const csvRows: (string | number | null)[][] = [
    [
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
      // 保存先(ローカルFS / Supabase Storage)はlib/photoStorage.tsが切り替える
      const data = await readVisitPhoto(parsed.relPath);
      if (!data) continue; // 欠損はスキップ
      const zipPath = `photos/${path.posix.basename(relPath)}`;
      photoEntries.push({ name: zipPath, data: Buffer.from(data) });
      zipPaths.push(zipPath);
    }
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
      "Content-Disposition": `attachment; filename="travel-log-visits-${typeKey}-${jstDate}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
