import type { DiscoveryBackend } from "@/lib/spotDiscovery";

/**
 * 周辺のAI探索(`/api/spots/discover`)の接続先と、相手・モデル・effortの既定。
 * **サーバー専用**(環境変数を読む。クライアントコンポーネントから読まない)。
 *
 * **相手・モデル・effortは探索の画面で選ぶ**(`AiSpotDiscoverySearchModal`)。
 * ここが持つのは「何も選ばれなかったときに何を使うか」だけ ——
 * 「近くの昼食を探す」ように、その場の目的で軽くも重くもしたい設定なので、
 * 管理画面で全員ぶんを1つに決める形にはしない(選ぶ人と使う人が同じ画面にいる)。
 *
 * 接続先だけは環境変数`CHIEZO_BASE_URL`で決まる(未設定なら機能そのものが出ない)。
 * IPやホスト名をDBやコードに置かないため。
 */

export const DEFAULT_DISCOVERY_BACKEND = "antigravity";

/**
 * effortが選ばれなかったときの既定。**軽いほうに倒してある** —— この機能は
 * その場で答えが欲しい使い方が主だから(実測: low で32秒、既定のままだと数分)。
 * **相手がeffortを持つときだけ送る**(持たない相手=codexに送るとchiezoが400で断る)
 */
export const DEFAULT_DISCOVERY_EFFORT = "low";

/** `CHIEZO_BASE_URL`(末尾のスラッシュを落としたもの)。未設定ならnull */
export function discoveryBaseUrl(): string | null {
  const raw = process.env.CHIEZO_BASE_URL?.trim();
  return raw ? raw.replace(/\/+$/, "") : null;
}

/** 相手が選ばれなかったときの既定(環境変数 → 決め打ち) */
export function defaultDiscoveryBackend(): string {
  return process.env.CHIEZO_AI_BACKEND?.trim() || DEFAULT_DISCOVERY_BACKEND;
}

interface ChiezoBackendsResponse {
  backends?: {
    id?: unknown;
    label?: unknown;
    web?: unknown;
    models?: unknown;
    efforts?: unknown;
  }[];
}

/**
 * chiezoに「いま話せる相手」を聞く。探索の画面の選択肢と、投げる前の検証に使う。
 * 相手が落ちていても探索そのものは止めない(選択肢が出ないだけ)ので、
 * 失敗はErrorで返して呼び出し側が文言にする
 */
export async function fetchDiscoveryBackends(baseUrl: string): Promise<DiscoveryBackend[]> {
  const res = await fetch(`${baseUrl}/v1/ai/backends`, {
    headers: { Accept: "application/json", "User-Agent": "travel-log-personal-app/1.0" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`AI中継サーバーが ${res.status} を返しました。`);
  const body = (await res.json()) as ChiezoBackendsResponse;
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && !!v) : [];
  return (body.backends ?? [])
    .filter((b) => typeof b.id === "string" && b.id)
    .map((b) => ({
      id: b.id as string,
      label: typeof b.label === "string" && b.label ? b.label : (b.id as string),
      web: b.web === true,
      models: strings(b.models),
      efforts: strings(b.efforts),
    }));
}

/**
 * 画面から届いた相手・モデル・effortを、chiezoが受け付ける形に確かめて返す。
 * **選ばれなかったところは既定で埋める**。おかしな値は握りつぶさずエラーにする
 * (綴り違いのまま投げると、待たされた末に相手が400を返して原因が分かりにくい)
 */
export function resolveDiscoveryChoice(
  backends: DiscoveryBackend[],
  choice: { backend?: string | null; model?: string | null; effort?: string | null }
): { backend: string; model: string | null; effort: string | null } | { error: string } {
  const backendId = choice.backend?.trim() || defaultDiscoveryBackend();
  const found = backends.find((b) => b.id === backendId);
  // 相手の一覧が取れなかったとき(chiezoが一時的に答えない等)は素通しする ——
  // 確かめられないことを理由に探索そのものを止めない
  if (backends.length > 0) {
    if (!found) return { error: `「${backendId}」はいま話せる相手にありません。` };
    if (!found.web) {
      return { error: `「${found.label}」はweb検索を持たないため、周辺の探索には使えません。` };
    }
  }
  const model = choice.model?.trim() || null;
  if (model && found && found.models.length > 0 && !found.models.includes(model)) {
    return { error: `「${model}」は${found.label}で選べるモデルにありません。` };
  }
  const chosenEffort = choice.effort?.trim() || null;
  if (chosenEffort && found && found.efforts.length > 0 && !found.efforts.includes(chosenEffort)) {
    return { error: `「${chosenEffort}」は${found.label}で選べる深さにありません。` };
  }
  // 未選択なら軽いほうに倒す。**相手がeffortを持つときだけ**送る
  const effort =
    chosenEffort ??
    (found?.efforts.includes(DEFAULT_DISCOVERY_EFFORT) ? DEFAULT_DISCOVERY_EFFORT : null);
  return { backend: backendId, model, effort };
}
