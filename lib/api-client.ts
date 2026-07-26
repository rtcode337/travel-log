import type {
  AppUser,
  MyReview,
  PublicReview,
  Review,
  Role,
  Spot,
  SpotDeletion,
  SpotHide,
  SpotNote,
  SpotRoute,
  SpotType,
  SpotTypeSettingKey,
  Visit,
  VisitPlan,
  VisitPlanList,
} from "@/lib/types";

interface Result<T> {
  data: T | null;
  error: { message: string } | null;
}

// ページ(/map ↔ /spots など)を行き来するたびに同じGETを取り直さないための
// タブ内キャッシュ。pathをキーに、進行中/完了済みのリクエストをそのまま保持する
// (同時に同じpathへ複数箇所からリクエストが飛んでも1回にまとまる副次効果もある)。
// 書き込み系(GET以外)が成功したら、鮮度を個別に追うより丸ごと破棄する方が単純で安全。
const getCache = new Map<string, Promise<Result<unknown>>>();

async function fetchAndParse<T>(
  path: string,
  init?: RequestInit
): Promise<Result<T>> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    return { data: null, error: { message: body?.error ?? res.statusText } };
  }
  // APIは基本 { data: T } でラップして返すが、一部( /api/auth/status 等)は素のJSONを返す。
  // `body?.data ?? body` だと data: null (該当データなしの正常系)を素のJSON側と区別できず
  // ラッパーオブジェクトごと返してしまうため、"data"キーの有無で判定する
  const data = body && typeof body === "object" && "data" in body ? body.data : body;
  return { data: data as T, error: null };
}

async function request<T>(
  path: string,
  init?: RequestInit
): Promise<Result<T>> {
  const method = (init?.method ?? "GET").toUpperCase();

  if (method === "GET") {
    const cached = getCache.get(path);
    if (cached) return cached as Promise<Result<T>>;

    const promise = fetchAndParse<T>(path, init);
    getCache.set(path, promise);
    promise.then((result) => {
      if (result.error) getCache.delete(path); // 失敗はキャッシュに残さず、次回また取り直せるようにする
    });
    return promise;
  }

  const result = await fetchAndParse<T>(path, init);
  if (!result.error) getCache.clear();
  return result;
}

export const api = {
  auth: {
    status: () =>
      request<{ hasUser: boolean; googleEnabled: boolean }>("/api/auth/status"),
    setup: (email: string, password: string) =>
      request("/api/auth/setup", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    login: (email: string, password: string) =>
      request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    logout: () => request("/api/auth/logout", { method: "POST" }),
    me: () => request<{ id: string; role: Role; email: string }>("/api/auth/me"),
  },
  spots: {
    list: (status: string | undefined, opts: { type: string }) => {
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      qs.set("type", opts.type);
      return request<Spot[]>(`/api/spots?${qs.toString()}`);
    },
    listPage: (opts: {
      type: string;
      page: number;
      search?: string;
      series?: string[];
    }) => {
      const qs = new URLSearchParams();
      qs.set("type", opts.type);
      qs.set("page", String(opts.page));
      if (opts.search) qs.set("search", opts.search);
      for (const series of opts.series ?? []) qs.append("series", series);
      return request<{ items: Spot[]; total: number; availableSeries: string[] }>(
        `/api/spots?${qs.toString()}`
      );
    },
    get: (id: string) => request<Spot>(`/api/spots/${id}`),
    create: (spot: unknown, type: string) =>
      request<Spot>(`/api/spots?type=${encodeURIComponent(type)}`, {
        method: "POST",
        body: JSON.stringify(spot),
      }),
    createMany: (spots: unknown[], type: string) =>
      request<Spot[]>(`/api/spots?type=${encodeURIComponent(type)}`, {
        method: "POST",
        body: JSON.stringify(spots),
      }),
    update: (id: string, spot: unknown) =>
      request<Spot>(`/api/spots/${id}`, {
        method: "PATCH",
        body: JSON.stringify(spot),
      }),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/api/spots/${id}`, { method: "DELETE" }),
    setStatus: (id: string, status: "published" | "rejected" | "pending") =>
      request<Spot>(`/api/spots/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    bulkApprove: (type: string) =>
      request<Spot[]>(`/api/spots/bulk-approve?type=${encodeURIComponent(type)}`, {
        method: "POST",
      }),
    purgePreview: (type: string) =>
      request<{ count: number }>(
        `/api/spots/purge?type=${encodeURIComponent(type)}`
      ),
    purgeApply: (type: string) =>
      request<{ deletedCount: number }>(
        `/api/spots/purge?type=${encodeURIComponent(type)}`,
        { method: "POST" }
      ),
    deleteByKeysPreview: (type: string, keys: string[]) =>
      request<{
        matchedCount: number;
        notFoundKeys: string[];
        sampleNames: string[];
      }>(`/api/spots/delete-by-keys?type=${encodeURIComponent(type)}`, {
        method: "POST",
        body: JSON.stringify({ keys, dryRun: true }),
      }),
    deleteByKeysApply: (type: string, keys: string[]) =>
      request<{ deletedCount: number; notFoundKeys: string[] }>(
        `/api/spots/delete-by-keys?type=${encodeURIComponent(type)}`,
        { method: "POST", body: JSON.stringify({ keys }) }
      ),
  },
  spotDeletions: {
    // 削除の墓標(画面から個別削除されたCSV由来の公開スポット)。還元用エクスポートで使う
    list: (type: string) =>
      request<SpotDeletion[]>(`/api/spot-deletions?type=${encodeURIComponent(type)}`),
  },
  routes: {
    list: (type: string) =>
      request<SpotRoute[]>(`/api/routes?type=${encodeURIComponent(type)}`),
    // ルート名ごとにシリーズ・説明・状態・経由地を丸ごと置き換えるupsert(ルートCSVインポート用)。
    // points[].descriptionはその経由地から次の経由地への区間の説明(最終地点はnull)
    replace: (
      type: string,
      routes: {
        name: string;
        series: string | null;
        description: string | null;
        status: string;
        points: { spot_id: string; description: string | null }[];
      }[]
    ) =>
      request<{ updatedCount: number }>(
        `/api/routes?type=${encodeURIComponent(type)}`,
        { method: "POST", body: JSON.stringify({ routes }) }
      ),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/api/routes/${id}`, { method: "DELETE" }),
  },
  geocode: {
    // scopeはスポット種別のregion_scope('jp' | 国コード | 'world')。検索対象の国と
    // 逆ジオでregionに入れる区分(都道府県/州・県/国)を決める。省略時は'jp'扱い
    search: (q: string, scope: string) =>
      request<{ name: string; lat: number; lng: number }[]>(
        `/api/geocode?q=${encodeURIComponent(q)}&scope=${encodeURIComponent(scope)}`
      ),
    reverse: (lat: number, lng: number, scope: string) =>
      request<{ region: string | null }>(
        `/api/geocode/reverse?lat=${lat}&lng=${lng}&scope=${encodeURIComponent(scope)}`
      ),
  },
  spotTypes: {
    list: () => request<SpotType[]>("/api/spot-types"),
    create: (key: string, label: string) =>
      request<SpotType>("/api/spot-types", {
        method: "POST",
        body: JSON.stringify({ key, label }),
      }),
    setSetting: (id: string, key: SpotTypeSettingKey, value: boolean) =>
      request<SpotType>(`/api/spot-types/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ settings: { [key]: value } }),
      }),
    applySettings: (
      id: string,
      settings: Partial<Record<string, boolean | string>>,
      label?: string
    ) =>
      request<SpotType>(`/api/spot-types/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ settings, label }),
      }),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/api/spot-types/${id}`, { method: "DELETE" }),
  },
  appSettings: {
    get: () => request<SpotType>("/api/app-settings"),
    setActive: (spotTypeId: string) =>
      request<SpotType>("/api/app-settings", {
        method: "PATCH",
        body: JSON.stringify({ spot_type_id: spotTypeId }),
      }),
  },
  admin: {
    users: {
      list: () => request<AppUser[]>("/api/admin/users"),
      create: (email: string, password: string, role: Role, nickname?: string) =>
        request<AppUser>("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({ email, password, role, nickname }),
        }),
      setRole: (id: string, role: Role) =>
        request<AppUser>(`/api/admin/users/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ role }),
        }),
      setNickname: (id: string, nickname: string) =>
        request<AppUser>(`/api/admin/users/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ nickname }),
        }),
      delete: (id: string) =>
        request<{ ok: boolean }>(`/api/admin/users/${id}`, {
          method: "DELETE",
        }),
    },
  },
  visits: {
    list: (spotId?: string) =>
      request<Visit[]>(`/api/visits${spotId ? `?spot_id=${spotId}` : ""}`),
    create: (visit: unknown) =>
      request<Visit>("/api/visits", { method: "POST", body: JSON.stringify(visit) }),
    // 写真は「既存の相対パス(残す写真)」と「data URL(追加する写真)」の混在で送る
    update: (id: string, visit: unknown) =>
      request<Visit>(`/api/visits/${id}`, {
        method: "PATCH",
        body: JSON.stringify(visit),
      }),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/api/visits/${id}`, { method: "DELETE" }),
  },
  spotNotes: {
    // 未訪問記録(訪問記録にはしない個人メモ)。spot_id省略時は自分の全件
    list: (spotId?: string) =>
      request<SpotNote[]>(
        `/api/spot-notes${spotId ? `?spot_id=${spotId}` : ""}`
      ),
    create: (note: { spot_id: string; noted_on: string | null; memo: string }) =>
      request<SpotNote>("/api/spot-notes", {
        method: "POST",
        body: JSON.stringify(note),
      }),
    update: (id: string, note: { noted_on: string | null; memo: string }) =>
      request<SpotNote>(`/api/spot-notes/${id}`, {
        method: "PATCH",
        body: JSON.stringify(note),
      }),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/api/spot-notes/${id}`, { method: "DELETE" }),
  },
  spotHides: {
    // 非表示スポット(自分の地図・一覧から隠す設定)。spot_id省略時は自分の全件
    list: (spotId?: string) =>
      request<SpotHide[]>(
        `/api/spot-hides${spotId ? `?spot_id=${spotId}` : ""}`
      ),
    create: (spotId: string) =>
      request<SpotHide>("/api/spot-hides", {
        method: "POST",
        body: JSON.stringify({ spot_id: spotId }),
      }),
    delete: (spotId: string) =>
      request<{ ok: boolean }>(`/api/spot-hides/${spotId}`, {
        method: "DELETE",
      }),
  },
  visitPlans: {
    list: (spotId?: string) =>
      request<VisitPlan[]>(
        `/api/visit-plans${spotId ? `?spot_id=${spotId}` : ""}`
      ),
    create: (spotId: string) =>
      request<VisitPlan>("/api/visit-plans", {
        method: "POST",
        body: JSON.stringify({ spot_id: spotId }),
      }),
    delete: (spotId: string) =>
      request<{ ok: boolean }>(`/api/visit-plans/${spotId}`, {
        method: "DELETE",
      }),
  },
  visitPlanLists: {
    list: (typeKey: string) =>
      request<VisitPlanList[]>(
        `/api/visit-plan-lists?type=${encodeURIComponent(typeKey)}`
      ),
    get: (id: string) =>
      request<VisitPlanList>(`/api/visit-plan-lists/${id}`),
    create: (input: {
      type: string;
      title: string;
      description: string | null;
      start_date: string;
      end_date: string;
      spot_ids: string[];
    }) =>
      request<VisitPlanList>("/api/visit-plan-lists", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (
      id: string,
      input: {
        title: string;
        description: string | null;
        start_date: string;
        end_date: string;
        spot_ids: string[];
      }
    ) =>
      request<VisitPlanList>(`/api/visit-plan-lists/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/api/visit-plan-lists/${id}`, {
        method: "DELETE",
      }),
  },
  reviews: {
    list: (spotId: string, page = 1) =>
      request<{ items: PublicReview[]; total: number }>(
        `/api/reviews?spot_id=${spotId}&page=${page}`
      ),
    listMine: (typeKey: string) =>
      request<MyReview[]>(`/api/reviews?mine=1&type=${typeKey}`),
    create: (spotId: string, body: string) =>
      request<Review>("/api/reviews", {
        method: "POST",
        body: JSON.stringify({ spot_id: spotId, body }),
      }),
  },
};
