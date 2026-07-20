"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { parseCsv } from "@/lib/csv";
import { RANK_STYLES_SETTING_KEY } from "@/lib/rankStyle";
import {
  getSpotTypeSetting,
  parseSpotTypeDefinition,
  ROLE_LABELS,
  SPOT_ADMIN_ROLES,
  SPOT_TYPE_SETTING_KEYS,
  SPOT_TYPE_SETTING_LABELS,
  type AppUser,
  type Role,
  type Spot,
  type SpotType,
  type SpotTypeSettingKey,
} from "@/lib/types";

const ROLES: Role[] = ["admin", "spot_admin", "moderator", "user"];

// CSVインポートを1リクエストにまとめず1000件ずつに分けて送る(進捗表示のためと、
// 大量データで1リクエストがタイムアウトするのを避けるため)
const CSV_IMPORT_CHUNK_SIZE = 1000;

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

  // スポット種別設定の非表示ランクトグル・CSV取り込み後の件数把握のためだけに、
  // このスポット種別の全件(status問わず)を軽く保持しておく(一覧UIとしては出さない)
  const [spots, setSpots] = useState<Spot[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  const [purgeCount, setPurgeCount] = useState<number | null>(null);
  const [purgeChecking, setPurgeChecking] = useState(false);
  const [purgeApplying, setPurgeApplying] = useState(false);
  const [purgeMessage, setPurgeMessage] = useState<string | null>(null);
  const [purgeConfirmText, setPurgeConfirmText] = useState("");

  const [users, setUsers] = useState<AppUser[]>([]);
  // ロール・ニックネームは選択/入力しただけでは保存せず、ユーザーごとの
  // 「変更」ボタンを押した時だけAPIに反映する下書き
  const [roleDrafts, setRoleDrafts] = useState<Record<string, Role>>({});
  const [nicknameDrafts, setNicknameDrafts] = useState<Record<string, string>>({});
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
  const [importingType, setImportingType] = useState(false);
  const [defaultTypeMessage, setDefaultTypeMessage] = useState<string | null>(
    null
  );
  const [typeSettingsMessage, setTypeSettingsMessage] = useState<
    string | null
  >(null);

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

  const handleCheckPurge = async () => {
    setPurgeChecking(true);
    setPurgeMessage(null);
    setPurgeCount(null);
    try {
      const { data, error } = await api.spots.purgePreview(typeKey);
      if (error) {
        setPurgeMessage("件数の確認に失敗しました: " + error.message);
        return;
      }
      setPurgeCount(data?.count ?? 0);
    } finally {
      setPurgeChecking(false);
    }
  };

  const handleApplyPurge = async () => {
    if (purgeCount === null || purgeCount === 0) return;
    if (purgeConfirmText !== typeKey) return;
    if (
      !confirm(
        `「${currentTypeLabel}」(${typeKey})の全スポット${purgeCount}件を削除しますか?` +
          `公開・承認待ち・却下・非公開を問わず全て対象で、紐づく訪問記録・訪問予定・` +
          `口コミ・写真も全ユーザー分削除されます。この操作は取り消せません。`
      )
    )
      return;
    setPurgeApplying(true);
    setPurgeMessage(null);
    try {
      const { data, error } = await api.spots.purgeApply(typeKey);
      if (error) {
        setPurgeMessage("削除に失敗しました: " + error.message);
        return;
      }
      setPurgeMessage(`${data?.deletedCount ?? 0}件削除しました。`);
      setPurgeCount(null);
      setPurgeConfirmText("");
      load();
    } finally {
      setPurgeApplying(false);
    }
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

  const handleChangeUser = async (
    user: AppUser,
    { nickname, role }: { nickname: string; role: Role }
  ) => {
    const errors: string[] = [];
    if (nickname !== (user.nickname ?? "")) {
      const { error } = await api.admin.users.setNickname(user.id, nickname);
      if (error) errors.push("ニックネーム: " + error.message);
    }
    if (role !== user.role) {
      if (user.id === myId) {
        errors.push("自分自身のロールは変更できません。");
      } else {
        const { error } = await api.admin.users.setRole(user.id, role);
        if (error) errors.push("ロール: " + error.message);
      }
    }
    setUserMessage(
      errors.length > 0
        ? "変更に失敗しました: " + errors.join(" / ")
        : `${user.email} を変更しました。`
    );
    setNicknameDrafts((prev) => {
      const next = { ...prev };
      delete next[user.id];
      return next;
    });
    setRoleDrafts((prev) => {
      const next = { ...prev };
      delete next[user.id];
      return next;
    });
    loadUsers();
  };

  const handleDeleteUser = async (user: AppUser) => {
    if (user.id === myId) {
      setUserMessage("自分自身は削除できません。");
      return;
    }
    if (!confirm(`${user.email} を削除しますか?この操作は取り消せません。`)) return;
    const { error } = await api.admin.users.delete(user.id);
    setUserMessage(
      error ? "削除に失敗しました: " + error.message : `${user.email} を削除しました。`
    );
    loadUsers();
  };

  const handleToggleSetting = async (
    type: SpotType,
    key: SpotTypeSettingKey
  ) => {
    const current = getSpotTypeSetting(type, key);
    const { error } = await api.spotTypes.setSetting(type.id, key, !current);
    const label = SPOT_TYPE_SETTING_LABELS[key];
    if (error) {
      setTypeSettingsMessage(`${label}の変更に失敗しました: ` + error.message);
      return;
    }
    setTypeSettingsMessage(
      `「${type.label}」の${label}を${!current ? "有効" : "無効"}にしました。`
    );
    loadSpotTypes();
  };

  const handleDeleteType = async (type: SpotType) => {
    if (
      !confirm(
        `「${type.label}」(${type.key})を削除しますか?このスポット種別に属するスポットが` +
          `残っている場合は、公開・承認待ち・却下・非公開を問わず全件(訪問記録・訪問予定・` +
          `口コミ・写真も含む)削除してから種別自体を削除します。この操作は取り消せません。`
      )
    )
      return;
    const { error } = await api.spotTypes.delete(type.id);
    if (error) {
      setTypeMessage(`「${type.label}」の削除に失敗しました: ` + error.message);
      return;
    }
    setTypeMessage(`「${type.label}」を削除しました。`);
    loadSpotTypes();
  };

  const handleSetDefaultType = async (type: SpotType) => {
    const { error } = await api.appSettings.setActive(type.id);
    if (error) {
      setDefaultTypeMessage("既定の変更に失敗しました: " + error.message);
      return;
    }
    setDefaultTypeMessage(`ログイン後の既定を「${type.label}」に変更しました。`);
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

  const handleCreateTypeFromJson = async (file: File) => {
    setImportingType(true);
    setTypeMessage(null);
    try {
      let json: unknown;
      try {
        json = JSON.parse(await file.text());
      } catch {
        setTypeMessage("JSONの読み込みに失敗しました(構文エラー)。");
        return;
      }
      const parsed = parseSpotTypeDefinition(json);
      if ("error" in parsed) {
        setTypeMessage("JSONの内容が不正です: " + parsed.error);
        return;
      }
      const { key, label, settings, ranks } = parsed.data;

      const { data: created, error } = await api.spotTypes.create(key, label);
      if (error || !created) {
        setTypeMessage("追加に失敗しました: " + (error?.message ?? ""));
        return;
      }

      // ranksが指定されていれば、真偽値の設定と合わせて1回のPATCHで反映する
      // (省略時はDEFAULT_RANK_STYLES=観光地のA〜Eにフォールバックするので何もしない)
      const settingsToApply: Record<string, boolean | string> = {};
      for (const [k, v] of Object.entries(settings ?? {})) {
        if (v !== undefined) settingsToApply[k] = v;
      }
      if (ranks) {
        settingsToApply[RANK_STYLES_SETTING_KEY] = JSON.stringify(ranks);
      }

      if (Object.keys(settingsToApply).length > 0) {
        const { error: settingsError } = await api.spotTypes.applySettings(
          created.id,
          settingsToApply
        );
        if (settingsError) {
          setTypeMessage(
            `「${label}」を追加しましたが、設定の反映に失敗しました: ` +
              settingsError.message
          );
          loadSpotTypes();
          return;
        }
      }

      setTypeMessage(`「${label}」をJSONから追加しました。`);
      loadSpotTypes();
    } finally {
      setImportingType(false);
    }
  };

  // name+prefecture+lat+lng の完全一致を「同じスポット」とみなす差分更新用のキー。
  // municipalityは使わない — 種別によっては同一市区町村内に同名のスポットが
  // 複数あることも珍しくなく、name+prefecture+municipalityだと別スポットを
  // 誤って同一視してしまうため
  const spotDiffKey = (
    name: string,
    prefecture: string,
    lat: number,
    lng: number
  ) => `${name}|${prefecture}|${lat}|${lng}`;

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
            // CSVインポートはこのページ(spot_admin/admin専用)からのみ行えるため、
            // 承認待ちを経由せずそのまま公開する
            status: "published",
          });
      }
      if (errors.length > 0) {
        setMessage(
          `エラーがあるためインポートを中止しました:\n` + errors.join("\n")
        );
        return;
      }

      // 差分更新: 既に(status問わず)このスポット種別に存在する行、およびCSV内で
      // 重複している行はスキップし、新規分だけ追加する
      const existingKeys = new Set(
        spots.map((s) => spotDiffKey(s.name, s.prefecture, s.lat, s.lng))
      );
      const seenKeys = new Set<string>();
      const newRecords = [];
      for (const record of records) {
        const key = spotDiffKey(record.name, record.prefecture, record.lat, record.lng);
        if (existingKeys.has(key) || seenKeys.has(key)) continue;
        seenKeys.add(key);
        newRecords.push(record);
      }
      const skippedCount = records.length - newRecords.length;

      if (newRecords.length === 0) {
        setMessage(`新規行はありませんでした(${skippedCount}件は既存のためスキップ)。`);
        return;
      }

      // 1000件ずつ順番に送信し、進捗を表示する(大量データで1リクエストが
      // タイムアウトするのも避けられる)
      let insertedCount = 0;
      setImportProgress({ done: 0, total: newRecords.length });
      for (
        let offset = 0;
        offset < newRecords.length;
        offset += CSV_IMPORT_CHUNK_SIZE
      ) {
        const chunk = newRecords.slice(offset, offset + CSV_IMPORT_CHUNK_SIZE);
        const { error } = await api.spots.createMany(chunk, typeKey);
        if (error) {
          setMessage(
            `${insertedCount}件追加した時点でインポートに失敗しました: ` +
              error.message
          );
          load();
          return;
        }
        insertedCount += chunk.length;
        setImportProgress({ done: insertedCount, total: newRecords.length });
      }

      setMessage(
        `${insertedCount}件追加しました` +
          (skippedCount > 0 ? `(${skippedCount}件は既存のためスキップ)。` : "。")
      );
      load();
    } finally {
      setImporting(false);
      setImportProgress(null);
    }
  };

  if (checkingRole || !hasPageAccess) return null;

  return (
    <main className="mx-auto max-w-6xl p-4">
      <h1 className="mb-4 text-lg font-bold">管理画面</h1>

      {/* スポット種別(ログイン後の既定・種別マスタ) */}
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
              {users.map((u) => {
                const nicknameDraft = nicknameDrafts[u.id] ?? u.nickname ?? "";
                const roleDraft = roleDrafts[u.id] ?? u.role;
                return (
                  <li key={u.id} className="flex flex-col gap-2 px-4 py-3">
                    <div>
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
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        autoComplete="off"
                        value={nicknameDraft}
                        placeholder="ニックネーム未設定(口コミ等に表示)"
                        onChange={(e) =>
                          setNicknameDrafts((prev) => ({
                            ...prev,
                            [u.id]: e.target.value,
                          }))
                        }
                        className="min-w-0 flex-1 rounded border border-gray-200 px-1.5 py-1 text-xs"
                      />
                      <select
                        value={roleDraft}
                        disabled={u.id === myId}
                        onChange={(e) =>
                          setRoleDrafts((prev) => ({
                            ...prev,
                            [u.id]: e.target.value as Role,
                          }))
                        }
                        title={u.id === myId ? "自分自身のロールは変更できません" : undefined}
                        className="shrink-0 rounded-lg border border-gray-300 px-2 py-1.5 text-sm disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {ROLE_LABELS[r]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={
                          nicknameDraft.trim() === (u.nickname ?? "") &&
                          roleDraft === u.role
                        }
                        onClick={() =>
                          handleChangeUser(u, {
                            nickname: nicknameDraft.trim(),
                            role: roleDraft,
                          })
                        }
                        className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        変更
                      </button>
                      {u.id !== myId && (
                        <button
                          type="button"
                          onClick={() => handleDeleteUser(u)}
                          className="shrink-0 rounded border border-red-300 px-2 py-1 text-xs font-medium text-red-600"
                        >
                          削除
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
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
        <div>
          <h2 className="mb-2 text-base font-bold">
            このスポット種別の管理({currentTypeLabel})
          </h2>

          <div className="flex flex-col gap-6">
            {isAdmin && currentType && (
              <section className="rounded-xl border border-gray-200 bg-white p-3">
                <h3 className="mb-2 text-base font-bold">スポット種別の設定</h3>
                {typeSettingsMessage && (
                  <p className="mb-3 whitespace-pre-wrap rounded-lg bg-blue-50 p-2 text-sm text-blue-800">
                    {typeSettingsMessage}
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  {SPOT_TYPE_SETTING_KEYS.map((key) => (
                    <label key={key} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={getSpotTypeSetting(currentType, key)}
                        onChange={() => handleToggleSetting(currentType, key)}
                      />
                      この種別で{SPOT_TYPE_SETTING_LABELS[key]}を有効にする
                    </label>
                  ))}
                </div>
              </section>
            )}

            <section className="rounded-xl border border-gray-200 bg-white p-3">
              <h3 className="mb-2 text-base font-bold">CSVインポート</h3>
              <p className="mb-3 text-xs text-gray-500">
                個別のスポット追加・編集・削除・承認/却下は、各スポットの詳細画面から行う。
                ここでは大量データのCSV一括取り込みのみ扱う(取り込んだスポットは最初から公開される)。
                差分更新: name+prefecture+lat+lngが完全一致するスポットが既に
                (status問わず)存在する行はスキップし、新規分だけ追加するため、同じCSVを
                何度アップロードしても重複登録されない。
              </p>

              {message && (
                <p className="mb-3 whitespace-pre-wrap rounded-lg bg-blue-50 p-2 text-sm text-blue-800">
                  {message}
                </p>
              )}

              {importProgress && (
                <div className="mb-3">
                  <p className="mb-1 text-sm text-gray-600">
                    インポート中… {importProgress.done} / {importProgress.total}件
                  </p>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all"
                      style={{
                        width: `${Math.round(
                          (importProgress.done / importProgress.total) * 100
                        )}%`,
                      }}
                    />
                  </div>
                </div>
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

          {isAdmin && (
            <section className="rounded-xl border border-red-200 bg-white p-3">
              <h3 className="mb-2 text-base font-bold text-red-700">
                スポット全削除
              </h3>
              <p className="mb-3 text-xs text-gray-500">
                「{currentTypeLabel}」({typeKey})のスポットを公開・承認待ち・却下・非公開
                問わず全件削除する。紐づく訪問記録・訪問予定・口コミ・写真も全ユーザー分
                まとめて削除され、元に戻せない。CSVインポート用データを外部で作り直した
                際などに、一度空にしてから入れ直す用途を想定。
              </p>

              {purgeMessage && (
                <p className="mb-3 whitespace-pre-wrap rounded-lg bg-red-50 p-2 text-sm text-red-800">
                  {purgeMessage}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleCheckPurge}
                  disabled={purgeChecking}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
                >
                  {purgeChecking ? "確認中…" : "件数を確認"}
                </button>
              </div>

              {purgeCount !== null && purgeCount > 0 && (
                <div className="mt-3 flex flex-col gap-2">
                  <p className="text-sm text-gray-600">
                    削除対象 {purgeCount}件。確認のため、下の欄に種別キー「{typeKey}」を
                    入力すると削除ボタンが有効になる。
                  </p>
                  <input
                    type="text"
                    autoComplete="off"
                    value={purgeConfirmText}
                    onChange={(e) => setPurgeConfirmText(e.target.value)}
                    placeholder={typeKey}
                    className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                  />
                  <button
                    onClick={handleApplyPurge}
                    disabled={purgeApplying || purgeConfirmText !== typeKey}
                    className="w-fit rounded-lg border border-red-400 bg-white px-3 py-1.5 text-sm font-medium text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {purgeApplying ? "削除中…" : `${purgeCount}件を全て削除`}
                  </button>
                </div>
              )}

              {purgeCount === 0 && (
                <p className="mt-3 text-sm text-gray-500">
                  対象スポットはありません。
                </p>
              )}
            </section>
          )}

          {isAdmin && (
            <div>
              <h2 className="mb-2 text-base font-bold">別のスポット種別の管理</h2>
              <section className="rounded-xl border border-gray-200 bg-white p-3">
                <p className="mb-3 text-xs text-gray-500">
                  現在開いている「{currentTypeLabel}」以外のスポット種別の一覧。種別名を
                  クリックするとそのページに移動する(公開/非公開の切り替えは、移動先の
                  「スポット種別の設定」から行う)。削除は非公開の種別のみ行える
                  (スポットが残っていれば全件削除してから種別自体を削除する)。
                </p>
                {typeMessage && (
                  <p className="mb-3 whitespace-pre-wrap rounded-lg bg-blue-50 p-2 text-sm text-blue-800">
                    {typeMessage}
                  </p>
                )}
                <ul className="mb-3 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                  {spotTypes
                    .filter((t) => t.key !== typeKey)
                    .map((t) => {
                      const isPublic = getSpotTypeSetting(t, "public_visible");
                      return (
                        <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                          <span className="flex-1 text-sm">
                            <Link
                              href={`/${t.key}/admin`}
                              className="text-blue-600 underline"
                            >
                              {t.label}
                            </Link>{" "}
                            <span className="text-gray-400">({t.key})</span>
                          </span>
                          <span className="w-12 shrink-0 text-xs text-gray-500">
                            {isPublic ? "公開" : "非公開"}
                          </span>
                          <span className="w-10 shrink-0 text-right">
                            {!isPublic && (
                              <button
                                type="button"
                                onClick={() => handleDeleteType(t)}
                                className="text-xs font-medium text-red-500 underline"
                              >
                                削除
                              </button>
                            )}
                          </span>
                        </li>
                      );
                    })}
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
                    + 種別を追加
                  </button>
                </form>
                <div className="mt-3 border-t border-gray-100 pt-3">
                  <p className="mb-2 text-xs text-gray-500">
                    設定情報込みのJSONファイルからも追加できる
                    (
                    <code>{"{ key, label, settings?, ranks? }"}</code>
                    形式。<code>ranks</code>はそのスポット種別で使えるランクの一覧と
                    表示スタイル(色・縁取り線の色・地図ピンの大きさ・ラベル)の配列で、
                    省略すると観光地のA〜Eが既定になる。travel-log-dataリポジトリの
                    各スポットキーフォルダ内の<code>settings.json</code>を参照)。
                  </p>
                  <label className="inline-block cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm">
                    {importingType ? "追加中…" : "JSONファイルから追加"}
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      disabled={importingType}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleCreateTypeFromJson(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </section>
            </div>
          )}

          {isAdmin && (
            <div>
              <h2 className="mb-2 text-base font-bold">
                ログイン後に自動で開く種別
              </h2>
              <section className="rounded-xl border border-gray-200 bg-white p-3">
                <p className="mb-3 text-xs text-gray-500">
                  ログイン後・ルート(/)アクセス時に自動で開く地図/リストの既定(全ユーザー共通)。
                  ここでの選択は既定を切り替えるだけで、他の種別を非表示にするものではない。
                </p>
                {defaultTypeMessage && (
                  <p className="mb-3 whitespace-pre-wrap rounded-lg bg-blue-50 p-2 text-sm text-blue-800">
                    {defaultTypeMessage}
                  </p>
                )}
                <select
                  value={defaultType?.id ?? ""}
                  onChange={(e) => {
                    const type = spotTypes.find((t) => t.id === e.target.value);
                    if (type) handleSetDefaultType(type);
                  }}
                  className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                >
                  {spotTypes
                    .filter((t) => getSpotTypeSetting(t, "public_visible"))
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                </select>
              </section>
            </div>
          )}
          </div>
        </div>
      </div>
    </main>
  );
}
