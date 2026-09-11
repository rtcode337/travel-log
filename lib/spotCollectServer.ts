import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_ADMIN_ROLES, type SpotType } from "@/lib/types";
import { SPOT_TYPE_SELECT } from "@/lib/spot-types-query";
import { discoveryBaseUrl } from "@/lib/aiDiscoveryConfig";
import {
  resolveCollectSource,
  type ChiezoCollection,
  type SpotCollectStatus,
} from "@/lib/spotCollect";

/**
 * 「情報を集めさせる」の受け口が共通で使う部品(サーバー専用)。
 *
 * **Route Handlerのファイルには置けない。** Next.jsはあそこから決まった名前
 * (GET/POST等)以外が出ていると型が合わずビルドを断るので、受け口をまたいで
 * 使うものはこちらへ切り出す。
 */

// 相手はローカルのSQLiteとAIの設定ファイルなので速いが、落ちていることはある
const CHIEZO_TIMEOUT_MS = 8_000;
const USER_AGENT = "travel-log-personal-app/1.0";



export async function chiezo<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit
): Promise<{ data: T | null; error: string | null }> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        "User-Agent": USER_AGENT,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(CHIEZO_TIMEOUT_MS),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      // chiezoは`{"error": "..."}`か`{"detail": {...}}`で返す。**そのまま出す** ——
      // 断られた理由(名前の規則・重複・止まっている)は画面で読めないと直せない
      const detail = body?.detail ?? body;
      const message =
        typeof detail === "string"
          ? detail
          : (detail?.error ?? detail?.reason ?? JSON.stringify(detail ?? {}));
      return { data: null, error: `${res.status}: ${message}` };
    }
    return { data: body as T, error: null };
  } catch (err) {
    return {
      data: null,
      error: err instanceof Error ? err.message : "知識サーバーに繋がりませんでした。",
    };
  }
}

/**
 * 収集の一覧から自分のぶんを引く。まだ依頼していなければnull。
 *
 * **一覧を引いて絞る**(`/v1/collect/{name}`を直接引かない) —— あちらは無いときに
 * 404を返すので、「まだ依頼していない」と「繋がらない」が同じ形になる。
 * 一覧なら、返ってきたうえで見つからないことが「まだ無い」だと言い切れる。
 */
export async function findCollection(
  baseUrl: string,
  source: string
): Promise<ChiezoCollection | null> {
  const { data } = await chiezo<{ collections?: ChiezoCollection[] }>(
    baseUrl,
    "/v1/collect"
  );
  const items = Array.isArray(data)
    ? (data as ChiezoCollection[])
    : (data?.collections ?? []);
  return items.find((c) => c.name === source) ?? null;
}

/** 権限・種別・接続先をまとめて確かめる。呼び出し側は`error`があればそれを返す */
export async function resolveCollectContext(request: Request): Promise<
  | { error: NextResponse }
  | { spotType: SpotType; baseUrl: string; source: string }
> {
  const user = await getCurrentUser();
  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  if (!SPOT_ADMIN_ROLES.includes(user.role)) {
    return { error: NextResponse.json({ error: "権限がありません。" }, { status: 403 }) };
  }
  const typeKey = new URL(request.url).searchParams.get("type");
  if (!typeKey) {
    return { error: NextResponse.json({ error: "type is required" }, { status: 400 }) };
  }
  const { rows } = await query<SpotType>(`${SPOT_TYPE_SELECT} where t.key = $1`, [typeKey]);
  const spotType = rows[0];
  if (!spotType) {
    return { error: NextResponse.json({ error: "存在しない種別です。" }, { status: 404 }) };
  }
  const baseUrl = discoveryBaseUrl();
  if (!baseUrl) {
    return {
      error: NextResponse.json(
        { error: "この環境では情報の収集を利用できません(CHIEZO_BASE_URL未設定)。" },
        { status: 503 }
      ),
    };
  }
  return { spotType, baseUrl, source: resolveCollectSource(spotType) };
}

export type { ChiezoCollection, SpotCollectStatus };
