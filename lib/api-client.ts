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
  return { data: (body?.data ?? body) as T, error: null };
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
    list: (status?: string) =>
      request<Spot[]>(`/api/spots${status ? `?status=${status}` : ""}`),
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
      create: (email: string, password: string, role: Role) =>
        request<AppUser>("/api/admin/users", {
          method: "POST",
          body: JSON.stringify({ email, password, role }),
        }),
      setRole: (id: string, role: Role) =>
        request<AppUser>(`/api/admin/users/${id}`, {
          method: "PATCH",
          body: JSON.stringify({ role }),
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
    list: (spotId: string) =>
      request<PublicReview[]>(`/api/reviews?spot_id=${spotId}`),
    mine: (spotId: string) =>
      request<Review | null>(`/api/reviews?spot_id=${spotId}&mine=true`),
    upsert: (spotId: string, body: string) =>
      request<Review>("/api/reviews", {
        method: "POST",
        body: JSON.stringify({ spot_id: spotId, body }),
      }),
  },
};
