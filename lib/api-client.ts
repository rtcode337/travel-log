import type { AppUser, PublicReview, Review, Role, Spot, SpotType, Visit } from "@/lib/types";

interface Result<T> {
  data: T | null;
  error: { message: string } | null;
}

async function request<T>(
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

export const api = {
  auth: {
    status: () => request<{ hasUser: boolean }>("/api/auth/status"),
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
    list: (status?: string, opts?: { includeHidden?: boolean }) => {
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      if (opts?.includeHidden) qs.set("includeHidden", "1");
      const q = qs.toString();
      return request<Spot[]>(`/api/spots${q ? `?${q}` : ""}`);
    },
    get: (id: string) => request<Spot>(`/api/spots/${id}`),
    create: (spot: unknown) =>
      request<Spot>("/api/spots", { method: "POST", body: JSON.stringify(spot) }),
    createMany: (spots: unknown[]) =>
      request<Spot[]>("/api/spots", { method: "POST", body: JSON.stringify(spots) }),
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
    bulkApprove: () =>
      request<Spot[]>("/api/spots/bulk-approve", { method: "POST" }),
  },
  geocode: {
    search: (q: string) =>
      request<{ name: string; lat: number; lng: number }[]>(
        `/api/geocode?q=${encodeURIComponent(q)}`
      ),
  },
  spotTypes: {
    list: () => request<SpotType[]>("/api/spot-types"),
    create: (key: string, label: string) =>
      request<SpotType>("/api/spot-types", {
        method: "POST",
        body: JSON.stringify({ key, label }),
      }),
    setReviewsEnabled: (id: string, reviewsEnabled: boolean) =>
      request<SpotType>(`/api/spot-types/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ reviews_enabled: reviewsEnabled }),
      }),
    setHiddenRanks: (id: string, hiddenRanks: string[]) =>
      request<SpotType>(`/api/spot-types/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ hidden_ranks: hiddenRanks }),
      }),
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
    },
  },
  visits: {
    list: (spotId?: string) =>
      request<Visit[]>(`/api/visits${spotId ? `?spot_id=${spotId}` : ""}`),
    create: (visit: unknown) =>
      request<Visit>("/api/visits", { method: "POST", body: JSON.stringify(visit) }),
    delete: (id: string) =>
      request<{ ok: boolean }>(`/api/visits/${id}`, { method: "DELETE" }),
  },
  reviews: {
    list: (spotId: string, page = 1) =>
      request<{ items: PublicReview[]; total: number }>(
        `/api/reviews?spot_id=${spotId}&page=${page}`
      ),
    create: (spotId: string, body: string) =>
      request<Review>("/api/reviews", {
        method: "POST",
        body: JSON.stringify({ spot_id: spotId, body }),
      }),
  },
};
