"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { parseCsv } from "@/lib/csv";
import {
  ROLE_LABELS,
  SPOT_ADMIN_ROLES,
  type AppUser,
  type Role,
  type Spot,
  type SpotType,
} from "@/lib/types";

const ROLES: Role[] = ["admin", "spot_admin", "moderator", "user"];

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

export default function AdminView({ typeKey }: { typeKey: string }) {
  const router = useRouter();
  const [checkingRole, setCheckingRole] = useState(true);
  const [hasPageAccess, setHasPageAccess] = useState(false);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const isAdmin = myRole === "admin";

  // スポットの種類設定の非表示ランクトグル・CSV取り込み後の件数把握のためだけに、
  // このスポット種類の全件(status問わず)を軽く保持しておく(一覧UIとしては出さない)
  const [spots, setSpots] = useState<Spot[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const [users, setUsers] = useState<AppUser[]>([]);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<Role>("user");
  const [newUserNickname, setNewUserNickname] = useState("");
  const [userMessage, setUserMessage] = useState<string | null>(null);

  const [spotTypes, setSpotTypes] = useState<SpotType[]>([]);
  const [defaultType, setDefaultType] = useState<SpotType | null>(null);
  const [newTypeKey, setNewTypeKey] = useState("");
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [typeMessage, setTypeMessage] = useState<string | null>(null);

  const currentType = useMemo(
    () => spotTypes.find((t) => t.key === typeKey) ?? null,
    [spotTypes, typeKey]
  );
  const currentTypeLabel = currentType?.label ?? typeKey;

  useEffect(() => {
    api.auth.me().then(({ data }) => {
      if (!data || !SPOT_ADMIN_ROLES.includes(data.role)) {
        router.replace(`/${typeKey}/map`);
        return;
      }
      setHasPageAccess(true);
      setMyRole(data.role);
      setMyId(data.id);
      setCheckingRole(false);
    });
  }, [router, typeKey]);

  const load = useCallback(async () => {
    const { data } = await api.spots.list(undefined, { type: typeKey });
    setSpots(data ?? []);
  }, [typeKey]);

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
    setDefaultType(active ?? null);
  }, []);

  useEffect(() => {
    if (!hasPageAccess) return;
    load();
    loadSpotTypes();
  }, [hasPageAccess, load, loadSpotTypes]);

  useEffect(() => {
    if (!isAdmin) return;
    loadUsers();
  }, [isAdmin, loadUsers]);

  const pendingCount = useMemo(
    () => spots.filter((s) => s.status === "pending").length,
    [spots]
  );

  const handleBulkApprove = async () => {
    if (!confirm(`承認待ちの${pendingCount}件をすべて公開しますか?`)) return;
    const { error } = await api.spots.bulkApprove(typeKey);
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

  const handleToggleEnabled = async (type: SpotType) => {
    const { error } = await api.spotTypes.setEnabled(type.id, !type.enabled);
    if (error) {
      setTypeMessage("有効/無効の変更に失敗しました: " + error.message);
      return;
    }
    setTypeMessage(
      `「${type.label}」を${!type.enabled ? "有効" : "無効"}にしました。`
    );
    loadSpotTypes();
  };

  const handleSetDefaultType = async (type: SpotType) => {
    const { error } = await api.appSettings.setActive(type.id);
    if (error) {
      setTypeMessage("既定の変更に失敗しました: " + error.message);
      return;
    }
    setTypeMessage(`ログイン後の既定を「${type.label}」に変更しました。`);
    setDefaultType(type);
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
      const { error } = await api.spots.createMany(records, typeKey);
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

  if (checkingRole || !hasPageAccess) return null;

  return (
    <main className="mx-auto max-w-6xl p-4">
      <h1 className="mb-4 text-lg font-bold">管理画面</h1>

      {/* スポットの種類(ログイン後の既定・種類マスタ) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        {/* 左カラム: ユーザー管理(admin専用) */}
        {isAdmin && (
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
        )}

        {/* 右カラム(またはadminでない場合は唯一のカラム): スポットの管理 */}
        <div className="flex flex-col gap-6">
          {isAdmin && (
            <section className="rounded-xl border border-gray-200 bg-white p-3">
              <h2 className="mb-2 text-base font-bold">スポットの種類</h2>
              <p className="mb-3 text-xs text-gray-500">
                ここでの選択は、ログイン後に自動で開く地図/リストの既定を切り替えるだけ
                (全ユーザー共通)。スポットの追加・編集・承認は、このページのURL(現在は
                「{currentTypeLabel}」)で対象の種類が決まる — 他の種類を扱いたい場合は
                種類ごとの「この種類を管理」リンクから移動する。
              </p>
              {typeMessage && (
                <p className="mb-3 whitespace-pre-wrap rounded-lg bg-blue-50 p-2 text-sm text-blue-800">
                  {typeMessage}
                </p>
              )}
              <ul className="mb-3 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                {spotTypes.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="radio"
                      name="default-spot-type"
                      checked={defaultType?.id === t.id}
                      onChange={() => handleSetDefaultType(t)}
                      title="ログイン後に自動で開く既定にする"
                    />
                    <span className="flex-1 text-sm">{t.label}</span>
                    <span className="text-xs text-gray-400">{t.key}</span>
                    <label
                      className="flex items-center gap-1 text-xs text-gray-500"
                      title="OFFにすると地図/一覧/アカウントページのリンクが消え、直接アクセスも404になる"
                    >
                      <input
                        type="checkbox"
                        checked={t.enabled}
                        onChange={() => handleToggleEnabled(t)}
                      />
                      有効
                    </label>
                    {t.key === typeKey ? (
                      <span className="text-xs font-medium text-blue-600">
                        管理中
                      </span>
                    ) : (
                      <Link
                        href={`/${t.key}/admin`}
                        className="text-xs text-blue-600 underline"
                      >
                        この種類を管理
                      </Link>
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
                  <label className="mb-1 block text-xs font-medium">
                    表示名
                  </label>
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
          )}

          {isAdmin && currentType && (
            <section className="rounded-xl border border-gray-200 bg-white p-3">
              <h2 className="mb-2 text-base font-bold">
                口コミ設定({currentTypeLabel})
              </h2>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={currentType.reviews_enabled}
                  onChange={() => handleToggleReviewsEnabled(currentType)}
                />
                この種類で口コミを有効にする
              </label>
            </section>
          )}

          <section className="rounded-xl border border-gray-200 bg-white p-3">
            <h2 className="mb-2 text-base font-bold">
              CSVインポート({currentTypeLabel})
            </h2>
            <p className="mb-3 text-xs text-gray-500">
              個別のスポット追加・編集・削除・承認/却下は、各スポットの詳細画面から行う。
              ここでは大量データのCSV一括取り込みのみ扱う(取り込んだスポットは承認待ちになる)。
            </p>

            {message && (
              <p className="mb-3 whitespace-pre-wrap rounded-lg bg-blue-50 p-2 text-sm text-blue-800">
                {message}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
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
              {pendingCount > 0 && (
                <button
                  onClick={handleBulkApprove}
                  className="rounded-lg border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-700"
                >
                  承認待ち{pendingCount}件をすべて承認
                </button>
              )}
            </div>

            <p className="mt-2 text-xs text-gray-400">
              CSV列: {CSV_COLUMNS.join(", ")}(name, prefecture, lat, lng は必須。rank/categoryは自由入力で空でも可)
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
