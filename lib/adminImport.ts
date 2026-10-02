/**
 * 管理画面の一括取り込み(スポットCSV・ルートCSV)の本体。GitHub・ZIPからの取り込みと
 * 個別のCSVインポートの両方がここを通る。画面の状態は持たず、進捗はコールバックで返す。
 * 設計の理由は docs/design/admin.md。
 */
import { api } from "@/lib/api-client";
import { parseCsv } from "@/lib/csv";
import { parseRank, type Rank } from "@/lib/rank";
import { parseCategoryList, sameCategories } from "@/lib/category";
import { type Spot, type SpotRoute } from "@/lib/types";

// CSVインポートを1リクエストにまとめず1000件ずつに分けて送る(進捗表示のためと、
// 大量データで1リクエストがタイムアウトするのを避けるため)
export const CSV_IMPORT_CHUNK_SIZE = 1000;

export const CSV_COLUMNS = [
  "key",
  "name",
  "name_kana",
  "lat",
  "lng",
  "region",
  "rank",
  "series",
  "categories",
  "description",
] as const;

// ルートCSV(スポットを巡った順に矢印で繋ぐ)の列。spot_keyはスポットCSVのkey列を指す。
// seriesは省略可(ルートを地図でどのシリーズの色に塗るか。同じrouteの全行に同じ値を書く)。
// descriptionはルート全体の説明(同じrouteの全行に同じ値)、leg_descriptionはその行の
// スポットから次のスポットへの区間の説明(行単位。最終地点の行は空欄)で、どちらも省略可
export const ROUTE_CSV_COLUMNS = [
  "route",
  "series",
  "seq",
  "spot_key",
  "description",
  "leg_description",
] as const;

/**
 * ヘッダーに定義外の列があれば、その一覧を返す(無ければ空配列)。
 * 知らない列は黙って無視されるため、列名の綴り違いや旧フォーマットのCSV
 * (category など、カテゴリ改名前の列名)を取り込むと、エラーも警告も
 * 出ないまま該当の値だけが欠けた状態で登録されてしまう。それを防ぐための検査
 */
export function unknownCsvColumns(
  header: string[],
  columns: readonly string[]
): string[] {
  return header.filter((h) => h !== "" && !columns.includes(h));
}


// name+lat+lng の完全一致を「同じスポット」とみなす差分更新用のキー
// (regionはlat/lngから決まる従属値のため含めない — lat/lngが同じでregionだけ
// 違うデータは想定しない。region表記の修正で別スポット扱いになるのも避けられる)
export const spotDiffKey = (name: string, lat: number, lng: number) =>
  `${name}|${lat}|${lng}`;

interface CsvSpotRecord {
  key: string | null;
  name: string;
  name_kana: string | null;
  lat: number;
  lng: number;
  region: string;
  /** A〜E。null = ランクなし(CSVにrank列が無い場合も含む) */
  rank: Rank | null;
  series: string | null;
  /** null = CSVにcategories列が無い(既存のカテゴリを触らない) */
  categories: string[] | null;
  description: string | null;
  status: string;
  origin: "csv";
}

/**
 * 一括インポートのAPI呼び出しをリトライ付きで実行する。一時的な失敗
 * (開発サーバーの再コンパイル・瞬間的なネットワーク断など)が1回あるだけで
 * 数千件のインポート全体が中断してしまうのを防ぐ。少し待って計3回まで試し、
 * それでも失敗したら最後のエラーを返す(差分インポートは同じ内容を再送しても
 * 二重登録にならないため、成否不明のまま再送しても安全)
 */
export const withRetry = async <T,>(
  run: () => Promise<{ data: T | null; error: { message: string } | null }>
): Promise<{ data: T | null; error: { message: string } | null }> => {
  let last = await run();
  for (const delay of [500, 2000]) {
    if (!last.error) return last;
    await new Promise((resolve) => setTimeout(resolve, delay));
    last = await run();
  }
  return last;
};

/**
 * スポットCSV(テキスト)を種別targetKeyへ差分インポートする共通処理。
 * このページのCSVインポートとGitHubリポジトリからの取り込みの両方から使う。
 * 検証エラー・途中失敗はErrorをthrowし、成功時は結果メッセージを返す
 */
export const runSpotsCsvImport = async (
  text: string,
  targetKey: string,
  existingSpots: Spot[],
  onProgress: (done: number, total: number) => void
): Promise<string> => {
    const rows = parseCsv(text);
    if (rows.length < 2) {
      throw new Error("CSVにデータ行がありません。");
    }
    const header = rows[0].map((h) => h.trim());
    // categories列を持たないCSVは「カテゴリを指定していない」だけなので、
    // 既存スポットのカテゴリを消さずに維持する(key列と同じ扱い)
    const hasCategoriesColumn = header.includes("categories");
    const idx = Object.fromEntries(
      CSV_COLUMNS.map((c) => [c, header.indexOf(c)])
    ) as Record<(typeof CSV_COLUMNS)[number], number>;
    for (const required of ["name", "lat", "lng", "region"] as const) {
      if (idx[required] === -1) {
        throw new Error(`CSVヘッダーに ${required} 列がありません。`);
      }
    }
    const unknownColumns = unknownCsvColumns(header, CSV_COLUMNS);
    if (unknownColumns.length > 0) {
      throw new Error(
        `CSVヘッダーに未対応の列があります: ${unknownColumns.join(", ")}\n` +
          `使える列は ${CSV_COLUMNS.join(", ")} です。` +
          `(category は categories に改名されています)`
      );
    }

    const records: CsvSpotRecord[] = [];
    const errors: string[] = [];
    for (let i = 1; i < rows.length; i++) {
      const get = (c: (typeof CSV_COLUMNS)[number]) =>
        idx[c] === -1 ? "" : (rows[i][idx[c]] ?? "").trim();
      const series = get("series") || null;
      // ランクはA〜Eのみ。それ以外の値は打ち間違いとして弾く
      // (黙って「なし」にすると、CSVを直すまで色と大きさが変わらない)
      const rawRank = get("rank");
      const rank = parseRank(rawRank);
      if (rawRank && !rank) {
        errors.push(`${i + 1}行目: rank「${rawRank}」はA〜Eではない`);
        continue;
      }
      // カテゴリはパイプ区切りの1列で複数持てる(例: 自然|夜景|展望)
      const categories = hasCategoriesColumn
        ? parseCategoryList(get("categories"))
        : null;
      const lat = Number(get("lat"));
      const lng = Number(get("lng"));
      if (!get("name")) errors.push(`${i + 1}行目: name が空`);
      else if (Number.isNaN(lat) || Number.isNaN(lng))
        errors.push(`${i + 1}行目: lat/lng が数値でない`);
      else
        records.push({
          key: get("key") || null,
          name: get("name"),
          name_kana: get("name_kana") || null,
          lat,
          lng,
          region: get("region"),
          rank,
          series,
          categories,
          description: get("description") || null,
          // CSVインポートはこのページ(spot_admin/admin専用)からのみ行えるため、
          // 承認待ちを経由せずそのまま公開する
          status: "published",
          // 登録経路の記録。手動追加(既定'manual')と区別し、還元用エクスポートの
          // 抽出対象から外す
          origin: "csv",
        });
    }
    if (errors.length > 0) {
      throw new Error(
        `エラーがあるためインポートを中止しました:\n` + errors.join("\n")
      );
    }

    // key列はDB側で種別内一意のため、CSV内の重複だけは事前に検出して中止する
    // (どちらの行を正とすべきか決められないため)
    // name+lat+lngのフォールバックは**keyを持たない既存行だけ**を対象にする。
    // keyを持つ行まで拾うと、同じ地点に置いた複数のスポット(同名・同座標でkeyだけ
    // 違う行。1つの場所が複数のシリーズに登場する種別で使う)が既存行に吸われ、
    // 上書きになって新しい行が入らない。keyを持つ行はkey一致だけで突き合わせる
    // (keyは一度割り当てたら変えない運用のため、これで取りこぼさない)
    const existingByDiffKey = new Map(
      existingSpots
        .filter((s) => !s.key)
        .map((s) => [spotDiffKey(s.name, s.lat, s.lng), s])
    );
    const existingByKey = new Map(
      existingSpots.filter((s) => s.key).map((s) => [s.key as string, s])
    );
    const seenCsvKeys = new Set<string>();
    const keyErrors: string[] = [];
    for (const record of records) {
      if (!record.key) continue;
      if (seenCsvKeys.has(record.key)) {
        keyErrors.push(`key「${record.key}」がCSV内で重複`);
      }
      seenCsvKeys.add(record.key);
    }
    if (keyErrors.length > 0) {
      throw new Error(
        `エラーがあるためインポートを中止しました:\n` + keyErrors.join("\n")
      );
    }

    // 差分更新: 既存行との同一判定はkey一致を最優先し(改名・座標修正もCSVから
    // 反映できるように)、keyで見つからなければ**keyを持たない既存行に限り**
    // name+lat+lngの完全一致で突き合わせる(keyを振る前に取り込んだ行を拾うための道)。
    // 一致した既存行は、内容がCSVと異なればCSVの内容で上書きし、同一ならスキップする
    // (同じCSVを何度アップロードしても2回目以降は何も起きない)。ただし公開以外の
    // 既存行(他ユーザーの承認待ち等。編集権限が投稿者本人に限られる)は上書きしない。
    // CSVにkey列が無い場合は既存行のkeyを消さず維持する
    const seenKeys = new Set<string>();
    const newRecords = [];
    const updates: { spot: Spot; record: CsvSpotRecord }[] = [];
    let unchangedCount = 0;
    let untouchableCount = 0;
    const isChanged = (spot: Spot, record: CsvSpotRecord) =>
      spot.name !== record.name ||
      spot.name_kana !== record.name_kana ||
      spot.lat !== record.lat ||
      spot.lng !== record.lng ||
      spot.region !== record.region ||
      spot.rank !== record.rank ||
      spot.series !== record.series ||
      (record.categories !== null &&
        !sameCategories(spot.categories, record.categories)) ||
      spot.description !== record.description ||
      (record.key !== null && spot.key !== record.key) ||
      // 手動追加(manual)の行がCSVと一致した=travel-log-dataへ還元済みなので、
      // 内容が同一でもPATCHしてorigin='csv'に倒す(次回の還元用エクスポートから外す)
      spot.origin !== "csv";
    // フォールバックで既に使った既存行(keyなし)は、CSVの別の行がもう一度
    // 拾わないようにする。同じ地点の複数行のうち2行目以降が同じ既存行を上書きし、
    // 最後の1行だけが残るのを防ぐ
    const usedExistingIds = new Set<string>();
    for (const record of records) {
      const diffKey = spotDiffKey(record.name, record.lat, record.lng);
      const byDiffKey = existingByDiffKey.get(diffKey);
      const existing =
        (record.key ? existingByKey.get(record.key) : undefined) ??
        (byDiffKey && !usedExistingIds.has(byDiffKey.id) ? byDiffKey : undefined);
      if (existing) {
        usedExistingIds.add(existing.id);
        if (existing.status !== "published") untouchableCount++;
        else if (isChanged(existing, record)) updates.push({ spot: existing, record });
        else unchangedCount++;
        continue;
      }
      // CSV内でname+lat+lngが重複している行。**keyを持つ行は別スポットとして通す**
      // (同じ地点に複数のスポットを置くための行。keyの重複は上で弾いてある)
      if (!record.key) {
        if (seenKeys.has(diffKey)) continue;
        seenKeys.add(diffKey);
      }
      newRecords.push(record);
    }

    if (newRecords.length === 0 && updates.length === 0) {
      return `追加・変更はありませんでした(${unchangedCount}件は既存と同一のためスキップ)。`;
    }

    // 1000件ずつ順番に送信し、進捗を表示する(大量データで1リクエストが
    // タイムアウトするのも避けられる)
    const totalCount = newRecords.length + updates.length;
    let insertedCount = 0;
    onProgress(0, totalCount);
    for (
      let offset = 0;
      offset < newRecords.length;
      offset += CSV_IMPORT_CHUNK_SIZE
    ) {
      const chunk = newRecords.slice(offset, offset + CSV_IMPORT_CHUNK_SIZE);
      const { error } = await withRetry(() =>
        api.spots.createMany(chunk, targetKey)
      );
      if (error) {
        throw new Error(
          `${insertedCount}件追加した時点でインポートに失敗しました: ` +
            error.message
        );
      }
      insertedCount += chunk.length;
      onProgress(insertedCount, totalCount);
    }

    // 既存スポットの上書き更新も新規と同じく1000件ずつの一括送信
    // (POST /api/spots/bulk-update)。1件ずつのPATCHはGitHub取り込みのような
    // 大量更新でラウンドトリップの積み重ねが重すぎた。CSVにkeyが無い行は既存の
    // keyを消さないよう、keyフィールド自体を送らない(API側が未指定時は維持する)
    let updatedCount = 0;
    for (
      let offset = 0;
      offset < updates.length;
      offset += CSV_IMPORT_CHUNK_SIZE
    ) {
      const chunk = updates.slice(offset, offset + CSV_IMPORT_CHUNK_SIZE);
      const { data: updatedRows, error } = await withRetry(() =>
        api.spots.updateMany(
          chunk.map(({ spot, record }) => ({
            id: spot.id,
            name: record.name,
            name_kana: record.name_kana,
            lat: record.lat,
            lng: record.lng,
            region: record.region,
            rank: record.rank,
            series: record.series,
            ...(record.categories !== null
              ? { categories: record.categories }
              : {}),
            description: record.description,
            ...(record.key !== null ? { key: record.key } : {}),
            origin: record.origin,
          })),
          targetKey
        )
      );
      if (error) {
        throw new Error(
          `${insertedCount}件追加・${updatedCount}件更新した時点で失敗しました: ` +
            error.message
        );
      }
      // 事前読み込み後に消えた・公開でなくなった行はAPI側でスキップされるため、
      // 実際に更新できた件数で数える
      updatedCount += updatedRows?.length ?? chunk.length;
      onProgress(insertedCount + updatedCount, totalCount);
    }

    return (
      `${insertedCount}件追加・${updatedCount}件更新しました` +
      (unchangedCount > 0 ? `(${unchangedCount}件は既存と同一のためスキップ)` : "") +
      (untouchableCount > 0
        ? `(${untouchableCount}件は公開以外のスポットのため未変更)`
        : "") +
      "。"
    );
};


/**
 * ルートCSV(テキスト)を種別targetKeyへ差分インポートする共通処理。
 * このページのルートCSVインポートとGitHubリポジトリからの取り込みの両方から使う。
 * 検証エラー・失敗はErrorをthrowし、成功時は結果メッセージを返す
 */
export const runRouteCsvImport = async (
  text: string,
  targetKey: string,
  targetSpots: Spot[],
  existingRoutes: SpotRoute[]
): Promise<string> => {
    const rows = parseCsv(text);
    if (rows.length < 2) {
      throw new Error("CSVにデータ行がありません。");
    }
    const header = rows[0].map((h) => h.trim());
    const idx = Object.fromEntries(
      ROUTE_CSV_COLUMNS.map((c) => [c, header.indexOf(c)])
    ) as Record<(typeof ROUTE_CSV_COLUMNS)[number], number>;
    for (const required of ["route", "seq", "spot_key"] as const) {
      if (idx[required] === -1) {
        throw new Error(`CSVヘッダーに ${required} 列がありません。`);
      }
    }
    const unknownColumns = unknownCsvColumns(header, ROUTE_CSV_COLUMNS);
    if (unknownColumns.length > 0) {
      throw new Error(
        `CSVヘッダーに未対応の列があります: ${unknownColumns.join(", ")}\n` +
          `使える列は ${ROUTE_CSV_COLUMNS.join(", ")} です。`
      );
    }

    // spot_keyはスポットのkey列(種別内一意)を指す。先に全行を検証してから送る
    const spotsByKey = new Map(
      targetSpots.filter((s) => s.key).map((s) => [s.key as string, s])
    );
    const errors: string[] = [];
    const grouped = new Map<
      string,
      { seq: number; spotId: string; legDescription: string | null }[]
    >();
    // series・descriptionはルート単位の値だが、CSVは行単位なので同じrouteの
    // 各行に同じ値が並ぶ。最初に現れた値を採り、同一route内で食い違う行はエラーにする
    // (leg_descriptionだけは行単位の値=その行のスポットから次のスポットへの区間の説明)
    const seriesByRoute = new Map<string, string | null>();
    const descriptionByRoute = new Map<string, string | null>();
    const seenSeq = new Set<string>();
    for (let i = 1; i < rows.length; i++) {
      const get = (c: (typeof ROUTE_CSV_COLUMNS)[number]) =>
        idx[c] === -1 ? "" : (rows[i][idx[c]] ?? "").trim();
      const route = get("route");
      const series = get("series") || null;
      const description = get("description") || null;
      const legDescription = get("leg_description") || null;
      const seq = Number(get("seq"));
      const spotKey = get("spot_key");
      if (route && seriesByRoute.has(route) && seriesByRoute.get(route) !== series) {
        errors.push(`${i + 1}行目: route「${route}」のseriesが他の行と食い違う`);
      }
      if (
        route &&
        descriptionByRoute.has(route) &&
        descriptionByRoute.get(route) !== description
      ) {
        errors.push(`${i + 1}行目: route「${route}」のdescriptionが他の行と食い違う`);
      }
      if (!route) errors.push(`${i + 1}行目: route が空`);
      else if (!Number.isFinite(seq)) errors.push(`${i + 1}行目: seq が数値でない`);
      else if (!spotKey) errors.push(`${i + 1}行目: spot_key が空`);
      else if (!spotsByKey.has(spotKey))
        errors.push(
          `${i + 1}行目: spot_key「${spotKey}」のスポットが存在しない(スポットCSVを先にインポートする)`
        );
      else if (seenSeq.has(`${route}|${seq}`))
        errors.push(`${i + 1}行目: route「${route}」の seq ${seq} が重複`);
      else {
        seenSeq.add(`${route}|${seq}`);
        if (!seriesByRoute.has(route)) seriesByRoute.set(route, series);
        if (!descriptionByRoute.has(route)) descriptionByRoute.set(route, description);
        const list = grouped.get(route) ?? [];
        list.push({ seq, spotId: spotsByKey.get(spotKey)!.id, legDescription });
        grouped.set(route, list);
      }
    }
    for (const [route, list] of grouped) {
      if (list.length < 2) errors.push(`route「${route}」の経由地が1件しかない`);
      // leg_descriptionは「その行のスポットから次のスポットへの区間」の説明のため、
      // 次の区間が無い最終地点に書かれていたら気づけるようエラーにする
      // (1つ前の行に書くつもりの値のずれを黙って捨てない)
      const last = [...list].sort((a, b) => a.seq - b.seq)[list.length - 1];
      if (last?.legDescription) {
        errors.push(
          `route「${route}」の最終地点(seq ${last.seq})に leg_description があるが、` +
            `最後の地点から先の区間は無い(区間の説明は出発側の行に書く)`
        );
      }
    }
    if (errors.length > 0) {
      throw new Error(
        `エラーがあるためインポートを中止しました:\n` + errors.join("\n")
      );
    }

    // 差分更新: 既存ルートとシリーズ・説明・経由地(区間の説明含む)の並びが完全一致する
    // ものはスキップし、変わったもの・新規のものだけを送る(送った分はルート単位で丸ごと
    // 置き換え)。スポットのCSVインポートと同じく常にstatus: 'published'を明示するため、
    // 公開以外の既存ルートは内容が同一でも公開に倒す(スキップしない)
    const pointsKey = (
      points: { spot_id: string; description: string | null }[]
    ) => JSON.stringify(points.map((p) => [p.spot_id, p.description ?? null]));
    const existingByName = new Map(
      existingRoutes.map((r) => [
        r.name,
        {
          series: r.series,
          description: r.description,
          status: r.status,
          pointsKey: pointsKey(r.points),
        },
      ])
    );
    const changed: {
      name: string;
      series: string | null;
      description: string | null;
      status: "published";
      points: { spot_id: string; description: string | null }[];
    }[] = [];
    let unchangedCount = 0;
    for (const [route, list] of grouped) {
      const points = list
        .sort((a, b) => a.seq - b.seq)
        .map((p) => ({ spot_id: p.spotId, description: p.legDescription }));
      const series = seriesByRoute.get(route) ?? null;
      const description = descriptionByRoute.get(route) ?? null;
      const existing = existingByName.get(route);
      if (
        existing?.pointsKey === pointsKey(points) &&
        existing.series === series &&
        existing.description === description &&
        existing.status === "published"
      ) {
        unchangedCount++;
        continue;
      }
      changed.push({
        name: route,
        series,
        description,
        status: "published",
        points,
      });
    }
    if (changed.length === 0) {
      return `変更はありませんでした(${unchangedCount}本は既存と同一のためスキップ)。`;
    }

    const { error } = await withRetry(() =>
      api.routes.replace(targetKey, changed)
    );
    if (error) {
      throw new Error("インポートに失敗しました: " + error.message);
    }
    return (
      `${changed.length}本の経路を追加・更新しました` +
      (unchangedCount > 0
        ? `(${unchangedCount}本は既存と同一のためスキップ)。`
        : "。")
    );
};
