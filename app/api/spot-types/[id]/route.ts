import { NextResponse } from "next/server";
import { pool, query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSpotTypeSetting, type SpotType } from "@/lib/types";
import { SPOT_TYPE_SELECT } from "@/lib/spot-types-query";
import { deleteVisitPhotos } from "@/lib/photos";
import { parseRankStyles, RANK_STYLES_SETTING_KEY } from "@/lib/rankStyle";
import {
  isValidRegionScope,
  isValidWikipediaLang,
  REGION_SCOPE_SETTING_KEY,
  WIKIPEDIA_LANG_SETTING_KEY,
} from "@/lib/region";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { id } = await params;
  const { settings } = await request.json();

  if (settings === undefined) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const { rows: existingRows } = await query("select 1 from spot_types where id = $1", [id]);
  if (!existingRows[0]) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // スポット種別ごとの追加設定(口コミ・Wikipediaリンク・管理者以外閲覧不可・
  // ランク設定・対象地域・Wikipedia言語等)。spot_typesに列を増やさずキーを増やせる
  // よう、spot_type_settings(key, value)へupsertする。値はboolean('true'/'false'の
  // 文字列で保存)か、rank_styles等のような文字列(そのまま保存)のどちらか
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }
  for (const [key, value] of Object.entries(settings)) {
    if (typeof value !== "boolean" && typeof value !== "string") {
      return NextResponse.json({ error: "invalid request" }, { status: 400 });
    }
    if (key === RANK_STYLES_SETTING_KEY && typeof value === "string") {
      if (parseRankStyles(value) === null) {
        return NextResponse.json(
          { error: `${RANK_STYLES_SETTING_KEY}のJSON形式が不正です。` },
          { status: 400 }
        );
      }
    }
    if (
      key === REGION_SCOPE_SETTING_KEY &&
      (typeof value !== "string" || !isValidRegionScope(value))
    ) {
      return NextResponse.json(
        {
          error: `${REGION_SCOPE_SETTING_KEY}は 'jp'・'world'・ISO 3166-1の国コード小文字のいずれかである必要があります。`,
        },
        { status: 400 }
      );
    }
    if (
      key === WIKIPEDIA_LANG_SETTING_KEY &&
      (typeof value !== "string" || !isValidWikipediaLang(value))
    ) {
      return NextResponse.json(
        { error: `${WIKIPEDIA_LANG_SETTING_KEY}は 'ja'・'en' のような言語コードである必要があります。` },
        { status: 400 }
      );
    }
    if (key === "public_visible" && !value) {
      // ログイン後の既定(app_settings.active_spot_type_id)がこの種別のままだと
      // 一般ユーザーのルート("/")が404するページへリダイレクトし続けてしまうため、
      // 既定の種別を非公開(一般公開OFF)にすることを禁止する
      const { rows: activeRows } = await query(
        "select 1 from app_settings where active_spot_type_id = $1",
        [id]
      );
      if (activeRows[0]) {
        return NextResponse.json(
          {
            error:
              "ログイン後既定の種別は一般公開を無効にできません。先に既定を変更してください。",
          },
          { status: 400 }
        );
      }
    }
    await query(
      `insert into spot_type_settings (spot_type_id, key, value)
       values ($1, $2, $3)
       on conflict (spot_type_id, key) do update set value = excluded.value`,
      [id, key, String(value)]
    );
  }

  const { rows } = await query<SpotType>(`${SPOT_TYPE_SELECT} where t.id = $1`, [id]);
  return NextResponse.json({ data: rows[0] });
}

/**
 * スポット種別そのものを削除する。この種別にスポットが残っていた場合は、
 * まず全件削除(スポット全削除と同じロジック: status問わずvisits/visit_plans/reviewsを
 * FKのon delete cascadeで消し、写真ファイルも削除)した上でspot_typesの行自体を消す。
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (user.role !== "admin") {
    return NextResponse.json({ error: "権限がありません。" }, { status: 403 });
  }

  const { id } = await params;

  const { rows: existingRows } = await query<SpotType>(
    `${SPOT_TYPE_SELECT} where t.id = $1`,
    [id]
  );
  if (!existingRows[0]) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (getSpotTypeSetting(existingRows[0], "public_visible")) {
    return NextResponse.json(
      { error: "一般公開中の種別は削除できません。先に非公開にしてください。" },
      { status: 400 }
    );
  }

  const { rows: activeRows } = await query(
    "select 1 from app_settings where active_spot_type_id = $1",
    [id]
  );
  if (activeRows[0]) {
    return NextResponse.json(
      { error: "ログイン後既定の種別は削除できません。先に既定を変更してください。" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  let photoRows: { photos: string[] }[] = [];
  try {
    await client.query("begin");
    const photoResult = await client.query<{ photos: string[] }>(
      `select v.photos from visits v
       join spots s on v.spot_id = s.id
       where s.spot_type_id = $1`,
      [id]
    );
    photoRows = photoResult.rows;
    await client.query("delete from spots where spot_type_id = $1", [id]);
    await client.query("delete from spot_types where id = $1", [id]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback").catch(() => {});
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 }
    );
  } finally {
    client.release();
  }

  await deleteVisitPhotos(photoRows.flatMap((r) => r.photos));
  return NextResponse.json({ data: { ok: true } });
}
