import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { SPOT_ADMIN_ROLES, type SpotType } from "@/lib/types";
import { SPOT_TYPE_SELECT } from "@/lib/spot-types-query";
import { discoveryBaseUrl } from "@/lib/aiDiscoveryConfig";
import {
  resolveCollectSource,
  type ChiezoCollection,
  type ChiezoIngestStatus,
  type CollectChoice,
  type CollectExtractDraft,
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
/**
 * 下書きを書かせるときの待ち。**AIが1回動くぶん**待つ(十数秒〜数分)。
 * 周辺を探すと同じ180秒 —— 待たされた末に失敗するより、早く諦めて
 * 依頼文を変えて出し直せるほうがよい。
 */
const CHIEZO_DRAFT_TIMEOUT_MS = 180_000;
const USER_AGENT = "travel-log-personal-app/1.0";

export async function chiezo<T>(
  baseUrl: string,
  path: string,
  init?: RequestInit & { timeoutMs?: number }
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
      signal: AbortSignal.timeout(init?.timeoutMs ?? CHIEZO_TIMEOUT_MS),
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
/**
 * 1件ぶんの収集を引く。**回り終えた地域まで返るのはこちらだけ**
 * (一覧は件数しか持たない —— 積み上がると1件で数百KBになるため)。
 * まだ依頼していなければnull。
 */
export async function fetchCollection(
  baseUrl: string,
  source: string
): Promise<ChiezoCollection | null> {
  const { data } = await chiezo<ChiezoCollection>(
    baseUrl,
    `/v1/collect/${encodeURIComponent(source)}`
  );
  return data ?? null;
}

/**
 * いま取り込みが走っているか。**落ちていても機能ごと止めない**ので、
 * 取れなければnull(画面は「分からない」として描く)。
 */
export async function fetchIngestStatus(
  baseUrl: string
): Promise<ChiezoIngestStatus | null> {
  const { data } = await chiezo<ChiezoIngestStatus>(baseUrl, "/v1/ingest/status");
  return data ?? null;
}

/**
 * 抽出条件をAIに書かせる。**保存はしない** ——
 * その場で引いた件数と先頭数件が付いて返るので、確かめてから依頼する。
 *
 * **タグは完全一致でしか引けない**ので、それらしい名前を書かれると静かな0件になる。
 * 0件のときchiezoは実在するタグ名を候補として返すため、画面はそれを出して
 * 依頼文を書き直させる。
 */
export async function draftExtract(
  baseUrl: string,
  args: { want: string; name?: string } & CollectChoice
): Promise<{ data: CollectExtractDraft | null; error: string | null }> {
  return chiezo<CollectExtractDraft>(baseUrl, "/v1/collect/draft-extract", {
    method: "POST",
    timeoutMs: CHIEZO_DRAFT_TIMEOUT_MS,
    body: JSON.stringify(pruneEmpty(args)),
  });
}

/**
 * 巡回のプロンプトをAIに書かせる。**保存はしない**。
 *
 * 返させるJSONの形・`{partition}`の使い方・titleが重複の鍵であること、は
 * chiezo側がsystemで教えるので、こちらが渡すのは「何を集めたいか」だけでよい。
 */
export async function draftPrompt(
  baseUrl: string,
  args: { want: string; current?: string; feedback?: string; name?: string }
): Promise<{ data: { prompt: string } | null; error: string | null }> {
  return chiezo<{ prompt: string }>(baseUrl, "/v1/collect/draft", {
    method: "POST",
    timeoutMs: CHIEZO_DRAFT_TIMEOUT_MS,
    body: JSON.stringify(pruneEmpty(args)),
  });
}

/** 空文字・undefinedの項目を落とす(向こうは「書かなければ既定」で読む) */
function pruneEmpty(obj: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined && v !== "")
  );
}

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

export type { ChiezoCollection, ChiezoIngestStatus, SpotCollectStatus };
