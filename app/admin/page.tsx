"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { parseCsv } from "@/lib/csv";
import {
  PREFECTURES,
  ROLE_LABELS,
  distinctValues,
  type AppUser,
  type Category,
  type Rank,
  type Role,
  type Spot,
  type SpotType,
} from "@/lib/types";
import { getRankOrder } from "@/lib/rankStyle";
import RankBadge from "@/components/RankBadge";

const STATUS_LABELS: Record<Spot["status"], string> = {
  published: "公開中",
  pending: "承認待ち",
  rejected: "却下",
  private: "非公開",
};

const STATUS_STYLES: Record<Spot["status"], string> = {
  published: "bg-green-100 text-green-700",
  pending: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
  private: "bg-gray-200 text-gray-600",
};

const ROLES: Role[] = ["admin", "moderator", "user"];

interface SpotForm {
  name: string;
  name_kana: string;
  prefecture: string;
  municipality: string;
  lat: string;
  lng: string;
  rank: Rank;
  category: Category;
  description: string;
  official_url: string;
}

const EMPTY_FORM: SpotForm = {
  name: "",
  name_kana: "",
  prefecture: "",
  municipality: "",
  lat: "",
  lng: "",
  rank: "",
  category: "",
  description: "",
  official_url: "",
};

const CSV_COLUMNS = [
  "name",
  "name_kana",
  "prefecture",
  "municipality",
  "lat",
  "lng",
  "rank",
  "category",
  "description",
  "official_url",
] as const;

export default function AdminPage() {
  const router = useRouter();
  const [checkingRole, setCheckingRole] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);

  const [spots, setSpots] = useState<Spot[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Spot | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SpotForm>(EMPTY_FORM);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [rankFilter, setRankFilter] = useState<Rank | "all">("S");
  const [importing, setImporting] = useState(false);

  const [users, setUsers] = useState<AppUser[]>([]);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<Role>("user");
  const [newUserNickname, setNewUserNickname] = useState("");
  const [userMessage, setUserMessage] = useState<string | null>(null);

  const [spotTypes, setSpotTypes] = useState<SpotType[]>([]);
  const [activeType, setActiveType] = useState<SpotType | null>(null);
  const [newTypeKey, setNewTypeKey] = useState("");
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [typeMessage, setTypeMessage] = useState<string | null>(null);

  useEffect(() => {
    api.auth.me().then(({ data }) => {
      if (data?.role !== "admin") {
        router.replace("/map");
        return;
      }
      setIsAdmin(true);
      setMyId(data.id);
      setCheckingRole(false);
    });
  }, [router]);

  const load = useCallback(async () => {
    // 管理画面は非表示ランク(rank='Z'の未整理データ等)も含めて全件見える必要がある
    const { data } = await api.spots.list(undefined, { includeHidden: true });
    setSpots(data ?? []);
    setLoading(false);
  }, []);

  const loadUsers = useCallback(async () => {
    const { data } = await api.admin.users.list();
    setUsers(data ?? []);
  }, []);

  const loadSpotTypes = useCallback(async () => {
    const [{ data: types }, { data: active }] = await Promise.all([
      api.spotTypes.list(),
      api.appSettings.get(),
    ]);
    setSpotTypes(types ?? []);
    setActiveType(active ?? null);
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    load();
    loadUsers();
    loadSpotTypes();
  }, [isAdmin, load, loadUsers, loadSpotTypes]);

  const pendingSpots = useMemo(
    () => spots.filter((s) => s.status === "pending"),
    [spots]
  );

  const handleApprove = async (spot: Spot) => {
    const { error } = await api.spots.setStatus(spot.id, "published");
    setMessage(error ? "承認に失敗しました: " + error.message : `「${spot.name}」を承認しました。`);
    load();
  };

  const handleReject = async (spot: Spot) => {
    const { error } = await api.spots.setStatus(spot.id, "rejected");
    setMessage(error ? "却下に失敗しました: " + error.message : `「${spot.name}」を却下しました。`);
    load();
  };

  const handleBulkApprove = async () => {
    if (!confirm(`承認待ちの${pendingSpots.length}件をすべて公開しますか?`)) return;
    const { error } = await api.spots.bulkApprove();
    setMessage(error ? "一括承認に失敗しました: " + error.message : "すべて承認しました。");
    load();
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setUserMessage(null);
    const { error } = await api.admin.users.create(
      newUserEmail.trim(),
      newUserPassword,
      newUserRole,
      newUserNickname.trim() || undefined
    );
    if (error) {
      setUserMessage("作成に失敗しました: " + error.message);
      return;
    }
    setUserMessage(`${newUserEmail} を作成しました。`);
    setNewUserEmail("");
    setNewUserPassword("");
    setNewUserRole("user");
    setNewUserNickname("");
    loadUsers();
  };

  const handleChangeRole = async (user: AppUser, role: Role) => {
    if (user.id === myId) {
      setUserMessage("自分自身のロールは変更できません。");
      return;
    }
    const { error } = await api.admin.users.setRole(user.id, role);
    setUserMessage(
      error ? "ロール変更に失敗しました: " + error.message : `${user.email} のロールを変更しました。`
    );
    loadUsers();
  };

  const handleChangeNickname = async (user: AppUser, nickname: string) => {
    const { error } = await api.admin.users.setNickname(user.id, nickname);
    setUserMessage(
      error
        ? "ニックネームの変更に失敗しました: " + error.message
        : `${user.email} のニックネームを変更しました。`
    );
    loadUsers();
  };

  const handleToggleReviewsEnabled = async (type: SpotType) => {
    const { error } = await api.spotTypes.setReviewsEnabled(
      type.id,
      !type.reviews_enabled
    );
    if (error) {
      setTypeMessage("口コミ設定の変更に失敗しました: " + error.message);
      return;
    }
    setTypeMessage(
      `「${type.label}」の口コミを${!type.reviews_enabled ? "有効" : "無効"}にしました。`
    );
    loadSpotTypes();
  };

  const handleToggleHiddenRank = async (type: SpotType, rank: string) => {
    const nextHidden = type.hidden_ranks.includes(rank)
      ? type.hidden_ranks.filter((r) => r !== rank)
      : [...type.hidden_ranks, rank];
    const { error } = await api.spotTypes.setHiddenRanks(type.id, nextHidden);
    if (error) {
      setTypeMessage("非表示ランク設定の変更に失敗しました: " + error.message);
      return;
    }
    setTypeMessage(
      `「${type.label}」のランク${rank}を既定${
        nextHidden.includes(rank) ? "非表示" : "表示"
      }にしました。`
    );
    loadSpotTypes();
  };

  const handleSwitchType = async (type: SpotType) => {
    const { error } = await api.appSettings.setActive(type.id);
    if (error) {
      setTypeMessage("切替に失敗しました: " + error.message);
      return;
    }
    setTypeMessage(`「${type.label}」に切り替えました。`);
    setActiveType(type);
    load();
  };

  const handleCreateType = async (e: React.FormEvent) => {
    e.preventDefault();
    setTypeMessage(null);
    const { error } = await api.spotTypes.create(
      newTypeKey.trim(),
      newTypeLabel.trim()
    );
    if (error) {
      setTypeMessage("追加に失敗しました: " + error.message);
      return;
    }
    setTypeMessage(`「${newTypeLabel}」を追加しました。`);
    setNewTypeKey("");
    setNewTypeLabel("");
    loadSpotTypes();
  };

  const availableRanks = useMemo(
    () =>
      distinctValues(spots.map((s) => s.rank)).sort(
        (a, b) => getRankOrder(a) - getRankOrder(b)
      ),
    [spots]
  );
  const availableCategories = useMemo(
    () => distinctValues(spots.map((s) => s.category)),
    [spots]
  );

  const filtered = useMemo(() => {
    const q = search.trim();
    return spots.filter((s) => {
      if (rankFilter !== "all" && s.rank !== rankFilter) return false;
      if (!q) return true;
      return (
        s.name.includes(q) ||
        (s.name_kana ?? "").includes(q) ||
        s.prefecture.includes(q)
      );
    });
  }, [spots, search, rankFilter]);

  const openNew = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const openEdit = (spot: Spot) => {
    setEditing(spot);
    setForm({
      name: spot.name,
      name_kana: spot.name_kana ?? "",
      prefecture: spot.prefecture,
      municipality: spot.municipality ?? "",
      lat: String(spot.lat),
      lng: String(spot.lng),
      rank: spot.rank ?? "",
      category: spot.category ?? "",
      description: spot.description ?? "",
      official_url: spot.official_url ?? "",
    });
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      name: form.name.trim(),
      name_kana: form.name_kana.trim() || null,
      prefecture: form.prefecture,
      municipality: form.municipality.trim() || null,
      lat: Number(form.lat),
      lng: Number(form.lng),
      rank: form.rank.trim() || null,
      category: form.category.trim() || null,
      description: form.description.trim() || null,
      official_url: form.official_url.trim() || null,
    };
    if (Number.isNaN(payload.lat) || Number.isNaN(payload.lng)) {
      setMessage("緯度・経度は数値で入力してください。");
      return;
    }
    const { error } = editing
      ? await api.spots.update(editing.id, payload)
      : await api.spots.create(payload);
    if (error) {
      setMessage("保存に失敗しました: " + error.message);
      return;
    }
    setMessage(editing ? "更新しました。" : "追加しました。");
    setShowForm(false);
    load();
  };

  const handleDelete = async (spot: Spot) => {
    if (!confirm(`「${spot.name}」を削除しますか?(訪問記録も消えます)`))
      return;
    const { error } = await api.spots.delete(spot.id);
    setMessage(error ? "削除に失敗しました: " + error.message : "削除しました。");
    load();
  };

  const handleCsvFile = async (file: File) => {
    setImporting(true);
    setMessage(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length < 2) {
        setMessage("CSVにデータ行がありません。");
        return;
      }
      const header = rows[0].map((h) => h.trim());
      const idx = Object.fromEntries(
        CSV_COLUMNS.map((c) => [c, header.indexOf(c)])
      ) as Record<(typeof CSV_COLUMNS)[number], number>;
      for (const required of ["name", "prefecture", "lat", "lng"] as const) {
        if (idx[required] === -1) {
          setMessage(`CSVヘッダーに ${required} 列がありません。`);
          return;
        }
      }

      const records = [];
      const errors: string[] = [];
      for (let i = 1; i < rows.length; i++) {
        const get = (c: (typeof CSV_COLUMNS)[number]) =>
          idx[c] === -1 ? "" : (rows[i][idx[c]] ?? "").trim();
        const rank = get("rank") || null;
        const category = get("category") || null;
        const lat = Number(get("lat"));
        const lng = Number(get("lng"));
        if (!get("name")) errors.push(`${i + 1}行目: name が空`);
        else if (Number.isNaN(lat) || Number.isNaN(lng))
          errors.push(`${i + 1}行目: lat/lng が数値でない`);
        else
          records.push({
            name: get("name"),
            name_kana: get("name_kana") || null,
            prefecture: get("prefecture"),
            municipality: get("municipality") || null,
            lat,
            lng,
            rank,
            category,
            description: get("description") || null,
            official_url: get("official_url") || null,
          });
      }
      if (errors.length > 0) {
        setMessage(
          `エラーがあるためインポートを中止しました:\n` + errors.join("\n")
        );
        return;
      }
      const { error } = await api.spots.createMany(records);
      if (error) {
        setMessage("インポートに失敗しました: " + error.message);
        return;
      }
      setMessage(`${records.length}件インポートしました。`);
      load();
    } finally {
      setImporting(false);
    }
  };

  if (checkingRole || !isAdmin) return null;

  return (
    <main className="mx-auto max-w-6xl p-4">
      <h1 className="mb-4 text-lg font-bold">管理画面</h1>

      {/* スポットの種類(アプリ全体のモード切替) */}
      <section className="mb-6 rounded-xl border border-gray-200 bg-white p-3">
        <h2 className="mb-2 text-base font-bold">スポットの種類</h2>
        <p className="mb-3 text-xs text-gray-500">
          今アプリ全体で表示・追加対象になっている種類を切り替える(全ユーザーの
          地図・一覧に反映される)。
        </p>
        {typeMessage && (
          <p className="mb-3 whitespace-pre-wrap rounded-lg bg-blue-50 p-2 text-sm text-blue-800">
            {typeMessage}
          </p>
        )}
        <ul className="mb-3 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
          {spotTypes.map((t) => (
            <li key={t.id} className="px-3 py-2">
              <div className="flex items-center gap-3">
                <input
                  type="radio"
                  name="active-spot-type"
                  checked={activeType?.id === t.id}
                  onChange={() => handleSwitchType(t)}
                />
                <span className="flex-1 text-sm">{t.label}</span>
                <span className="text-xs text-gray-400">{t.key}</span>
                <label className="flex items-center gap-1 text-xs text-gray-500">
                  <input
                    type="checkbox"
                    checked={t.reviews_enabled}
                    onChange={() => handleToggleReviewsEnabled(t)}
                  />
                  口コミ
                </label>
              </div>
              {activeType?.id === t.id && availableRanks.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-6 text-xs text-gray-500">
                  <span>既定で非表示にするランク(地図・一覧では未取得。フィルタで選ぶと取得):</span>
                  {availableRanks.map((r) => (
                    <label key={r} className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={t.hidden_ranks.includes(r)}
                        onChange={() => handleToggleHiddenRank(t, r)}
                      />
                      {r}
                    </label>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
        <form
          onSubmit={handleCreateType}
          className="flex flex-wrap items-end gap-2"
        >
          <div>
            <label className="mb-1 block text-xs font-medium">
              キー(英数字)
            </label>
            <input
              required
              value={newTypeKey}
              onChange={(e) => setNewTypeKey(e.target.value)}
              placeholder="tourist"
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium">表示名</label>
            <input
              required
              value={newTypeLabel}
              onChange={(e) => setNewTypeLabel(e.target.value)}
              placeholder="観光地"
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white"
          >
            + 種類を追加
          </button>
        </form>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        {/* 左カラム: ユーザー管理 */}
        <section>
          <h2 className="mb-2 text-base font-bold">ユーザー管理</h2>
          {userMessage && (
            <p className="mb-3 whitespace-pre-wrap rounded-lg bg-blue-50 p-2 text-sm text-blue-800">
              {userMessage}
            </p>
          )}
          <ul className="mb-4 divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {u.email}
                    {u.id === myId && (
                      <span className="ml-1 text-xs text-gray-400">(自分)</span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    {u.has_password && "パスワード"}
                    {u.has_password && u.has_google && " / "}
                    {u.has_google && "Google"}
                  </p>
                  <input
                    type="text"
                    autoComplete="off"
                    defaultValue={u.nickname ?? ""}
                    placeholder="ニックネーム未設定(口コミ等に表示)"
                    onBlur={(e) => {
                      const value = e.target.value.trim();
                      if (value !== (u.nickname ?? "")) {
                        handleChangeNickname(u, value);
                      }
                    }}
                    className="mt-1 w-full rounded border border-gray-200 px-1.5 py-1 text-xs"
                  />
                </div>
                <select
                  value={u.role}
                  disabled={u.id === myId}
                  onChange={(e) => handleChangeRole(u, e.target.value as Role)}
                  title={u.id === myId ? "自分自身のロールは変更できません" : undefined}
                  className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>

          <form
            onSubmit={handleCreateUser}
            className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-3"
          >
            <div>
              <label className="mb-1 block text-sm font-medium">
                メールアドレス
              </label>
              <input
                type="email"
                autoComplete="email"
                required
                value={newUserEmail}
                onChange={(e) => setNewUserEmail(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                ニックネーム(任意)
              </label>
              <input
                type="text"
                autoComplete="off"
                value={newUserNickname}
                onChange={(e) => setNewUserNickname(e.target.value)}
                placeholder="口コミ等に表示する名前(未設定ならメールアドレス)"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                初期パスワード
              </label>
              <input
                type="password"
                autoComplete="new-password"
                required
                value={newUserPassword}
                onChange={(e) => setNewUserPassword(e.target.value)}
                placeholder="8文字以上"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">ロール</label>
              <select
                value={newUserRole}
                onChange={(e) => setNewUserRole(e.target.value as Role)}
                className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white"
            >
              + ユーザー追加
            </button>
            <p className="text-xs text-gray-400">
              Googleログインだけで使わせたい場合も、初期パスワードは必須です
              (あとから本人が同じメールアドレスでGoogleログインすると自動的に
              連携されます)。
            </p>
          </form>
        </section>

        {/* 右カラム: スポット管理 */}
        <section>
          <h2 className="mb-2 text-base font-bold">スポット管理</h2>

          {/* 承認待ちスポット */}
          {pendingSpots.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold text-amber-800">
              承認待ち({pendingSpots.length}件)
            </h2>
            <button
              onClick={handleBulkApprove}
              className="rounded border border-amber-400 bg-white px-2 py-1 text-xs font-medium text-amber-700"
            >
              すべて承認
            </button>
          </div>
          <ul className="space-y-2">
            {pendingSpots.map((spot) => (
              <li
                key={spot.id}
                className="flex items-center gap-2 rounded-lg bg-white p-2"
              >
                <RankBadge rank={spot.rank} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{spot.name}</p>
                  <p className="text-xs text-gray-500">
                    {spot.prefecture} ・ {spot.category}
                  </p>
                </div>
                <button
                  onClick={() => handleApprove(spot)}
                  className="rounded border border-green-300 px-2 py-1 text-xs text-green-700"
                >
                  承認
                </button>
                <button
                  onClick={() => handleReject(spot)}
                  className="rounded border border-red-200 px-2 py-1 text-xs text-red-500"
                >
                  却下
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 操作エリア */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={openNew}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white"
        >
          + スポット追加
        </button>
        <label className="cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm">
          {importing ? "インポート中…" : "CSVインポート"}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            disabled={importing}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleCsvFile(file);
              e.target.value = "";
            }}
          />
        </label>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="名前・都道府県で検索"
          className="min-w-40 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
      </div>

      {/* ランク絞り込み(現在のスポット種類に実在するランクのみ表示) */}
      {availableRanks.length > 0 && (
        <div className="mb-3 flex overflow-hidden rounded-lg border border-gray-300 bg-white text-sm">
          {([...availableRanks, "all"] as const).map((r) => (
            <button
              key={r}
              onClick={() => setRankFilter(r)}
              className={`flex-1 px-3 py-1.5 font-medium ${
                rankFilter === r
                  ? "bg-blue-600 text-white"
                  : "text-gray-500 hover:bg-gray-50"
              }`}
            >
              {r === "all" ? "すべて" : r}
            </button>
          ))}
        </div>
      )}

      <p className="mb-2 text-xs text-gray-400">
        CSV列: {CSV_COLUMNS.join(", ")}(name, prefecture, lat, lng は必須。rank/categoryは自由入力で空でも可)
      </p>

      {message && (
        <p className="mb-3 whitespace-pre-wrap rounded-lg bg-blue-50 p-2 text-sm text-blue-800">
          {message}
        </p>
      )}

      {/* スポット一覧 */}
      {loading ? (
        <p className="text-sm text-gray-500">読み込み中…</p>
      ) : (
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {filtered.map((spot) => (
            <li
              key={spot.id}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <RankBadge rank={spot.rank} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{spot.name}</p>
                <p className="text-xs text-gray-500">
                  {spot.prefecture} ・ {spot.category}
                </p>
              </div>
              {spot.status !== "published" && (
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[spot.status]}`}
                >
                  {STATUS_LABELS[spot.status]}
                </span>
              )}
              <button
                onClick={() => openEdit(spot)}
                className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-600"
              >
                編集
              </button>
              <button
                onClick={() => handleDelete(spot)}
                className="rounded border border-red-200 px-2 py-1 text-xs text-red-500"
              >
                削除
              </button>
            </li>
          ))}
        </ul>
      )}

        </section>
      </div>

      {/* 追加・編集フォーム */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowForm(false)}
        >
          <form
            onSubmit={handleSave}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-4"
          >
            <h2 className="font-bold">
              {editing ? "スポットを編集" : "スポットを追加"}
            </h2>
            <div>
              <label className="mb-1 block text-sm font-medium">名前 *</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                よみがな
              </label>
              <input
                value={form.name_kana}
                onChange={(e) =>
                  setForm({ ...form, name_kana: e.target.value })
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  都道府県 *
                </label>
                <select
                  required
                  value={form.prefecture}
                  onChange={(e) =>
                    setForm({ ...form, prefecture: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
                >
                  <option value="">選択</option>
                  {PREFECTURES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  市区町村
                </label>
                <input
                  value={form.municipality}
                  onChange={(e) =>
                    setForm({ ...form, municipality: e.target.value })
                  }
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  緯度 *
                </label>
                <input
                  required
                  inputMode="decimal"
                  value={form.lat}
                  onChange={(e) => setForm({ ...form, lat: e.target.value })}
                  placeholder="35.6812"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  経度 *
                </label>
                <input
                  required
                  inputMode="decimal"
                  value={form.lng}
                  onChange={(e) => setForm({ ...form, lng: e.target.value })}
                  placeholder="139.7671"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  ランク
                </label>
                <input
                  value={form.rank}
                  onChange={(e) =>
                    setForm({ ...form, rank: e.target.value as Rank })
                  }
                  list="rank-suggestions"
                  placeholder="種類による(観光地はS〜D)"
                  className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
                />
                <datalist id="rank-suggestions">
                  {availableRanks.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">
                  カテゴリ
                </label>
                <input
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value as Category })
                  }
                  list="category-suggestions"
                  className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
                />
                <datalist id="category-suggestions">
                  {availableCategories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">説明</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                公式サイトURL
              </label>
              <input
                type="url"
                value={form.official_url}
                onChange={(e) =>
                  setForm({ ...form, official_url: e.target.value })
                }
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm"
              >
                キャンセル
              </button>
              <button
                type="submit"
                className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white"
              >
                保存
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
