"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import HelpTip from "@/components/HelpTip";
import { api } from "@/lib/api-client";
import { buildCsv, parseCsv } from "@/lib/csv";
import { SERIES_STYLES_SETTING_KEY } from "@/lib/seriesStyle";
import {
  CATEGORIES_SETTING_KEY,
  formatCategoryList,
  parseCategoryList,
  resolveCategories,
  sameCategories,
} from "@/lib/category";
import {
  countryDisplayName,
  DEFAULT_WIKIPEDIA_LANG,
  isValidWikipediaLang,
  REGION_SCOPE_SETTING_KEY,
  regionFieldLabel,
  resolveRegionScope,
  resolveWikipediaLang,
  WIKIPEDIA_LANG_SETTING_KEY,
} from "@/lib/region";
import {
  getSpotTypeSetting,
  parseSpotTypeDefinition,
  ROLE_LABELS,
  SPOT_ADMIN_ROLES,
  SPOT_TYPE_SETTING_KEYS,
  SPOT_TYPE_SETTING_LABELS,
  STATUS_LABELS,
  type AppUser,
  type Role,
  type Spot,
  type SpotRoute,
  type SpotType,
  type SpotTypeSettingKey,
} from "@/lib/types";

const ROLES: Role[] = ["admin", "spot_admin", "moderator", "user"];

// CSVインポートを1リクエストにまとめず1000件ずつに分けて送る(進捗表示のためと、
// 大量データで1リクエストがタイムアウトするのを避けるため)
const CSV_IMPORT_CHUNK_SIZE = 1000;

const CSV_COLUMNS = [
  "key",
  "name",
  "name_kana",
  "lat",
  "lng",
  "region",
  "series",
  "categories",
  "description",
] as const;

// ルートCSV(スポットを巡った順に矢印で繋ぐ)の列。spot_keyはスポットCSVのkey列を指す。
// seriesは省略可(ルートを地図でどのシリーズの色に塗るか。同じrouteの全行に同じ値を書く)。
// descriptionはルート全体の説明(同じrouteの全行に同じ値)、leg_descriptionはその行の
// スポットから次のスポットへの区間の説明(行単位。最終地点の行は空欄)で、どちらも省略可
const ROUTE_CSV_COLUMNS = [
  "route",
  "series",
  "seq",
  "spot_key",
  "description",
  "leg_description",
] as const;

/**
 * ヘッダーに定義外の列があれば、その一覧を返す(無ければ空配列)。
 * 知らない列は黙って無視されるため、列名の綴り違いや旧フォーマットのCSV
 * (rank/category など、シリーズ改名前の列名)を取り込むと、エラーも警告も
 * 出ないまま該当の値だけが欠けた状態で登録されてしまう。それを防ぐための検査
 */
function unknownCsvColumns(
  header: string[],
  columns: readonly string[]
): string[] {
  return header.filter((h) => h !== "" && !columns.includes(h));
}

export default function AdminView({
  typeKey,
  buildNumber,
}: {
  typeKey: string;
  buildNumber?: string | null;
}) {
  const router = useRouter();
  const [checkingRole, setCheckingRole] = useState(true);
  const [hasPageAccess, setHasPageAccess] = useState(false);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const isAdmin = myRole === "admin";

  // スポット種別設定の非表示シリーズトグル・CSV取り込み後の件数把握のためだけに、
  // このスポット種別の全件(status問わず)を軽く保持しておく(一覧UIとしては出さない)
  const [spots, setSpots] = useState<Spot[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);

  // travel-log-dataへの還元用エクスポート(手動追加の公開スポット+削除の墓標)
  const [exportingManual, setExportingManual] = useState(false);
  const [manualExportMessage, setManualExportMessage] = useState<string | null>(null);

  // ルート(スポットを巡った順に矢印で繋ぐ)の一覧とCSVインポート用
  const [routes, setRoutes] = useState<SpotRoute[]>([]);
  const [routeMessage, setRouteMessage] = useState<string | null>(null);
  const [importingRoutes, setImportingRoutes] = useState(false);

  const [purgeCount, setPurgeCount] = useState<number | null>(null);
  const [purgeChecking, setPurgeChecking] = useState(false);
  const [purgeApplying, setPurgeApplying] = useState(false);
  const [purgeMessage, setPurgeMessage] = useState<string | null>(null);
  const [purgeConfirmText, setPurgeConfirmText] = useState("");

  // キー一覧を貼り付けての一括削除(travel-log-data側のexclude.txtを想定)
  const [deleteKeys, setDeleteKeys] = useState<string[]>([]);
  const [deleteKeysFileName, setDeleteKeysFileName] = useState<string | null>(
    null
  );
  const [deleteKeysPreview, setDeleteKeysPreview] = useState<{
    matchedCount: number;
    notFoundKeys: string[];
    sampleNames: string[];
  } | null>(null);
  const [deleteKeysChecking, setDeleteKeysChecking] = useState(false);
  const [deleteKeysApplying, setDeleteKeysApplying] = useState(false);
  const [deleteKeysMessage, setDeleteKeysMessage] = useState<string | null>(null);

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
  const [applyingTypeJson, setApplyingTypeJson] = useState(false);
  // GitHubリポジトリからの一括取り込み(admin専用)。repoは「owner/リポジトリ名」。
  // 「開く」でリポジトリ直下のcatalog.json(スポット種別の一覧)を取得して表示し、
  // 一覧から選んだ種別を適用する
  const [githubRepo, setGithubRepo] = useState("rtcode337/travel-log-data");
  const [githubCatalog, setGithubCatalog] = useState<
    { key: string; label: string }[] | null
  >(null);
  const [githubOpening, setGithubOpening] = useState(false);
  const [githubImporting, setGithubImporting] = useState(false);
  const [githubProgress, setGithubProgress] = useState<string | null>(null);
  const [githubMessage, setGithubMessage] = useState<string | null>(null);
  const [defaultTypeMessage, setDefaultTypeMessage] = useState<string | null>(
    null
  );
  const [typeSettingsMessage, setTypeSettingsMessage] = useState<
    string | null
  >(null);

  // 対象地域(region_scope)・Wikipedia言語(wikipedia_lang)の編集用下書き。
  // セレクトで「国を指定」を選んだときだけ国コード入力欄を出す
  const [regionScopeKind, setRegionScopeKind] = useState<
    "jp" | "country" | "world"
  >("jp");
  const [regionCountryCode, setRegionCountryCode] = useState("");
  const [wikiLangDraft, setWikiLangDraft] = useState(DEFAULT_WIKIPEDIA_LANG);
  const [savingRegionSettings, setSavingRegionSettings] = useState(false);

  // この種別で使うカテゴリ一覧(カンマ区切り)の編集用下書き
  const [categoriesDraft, setCategoriesDraft] = useState("");
  const [savingCategories, setSavingCategories] = useState(false);

  const currentType = useMemo(
    () => spotTypes.find((t) => t.key === typeKey) ?? null,
    [spotTypes, typeKey]
  );
  const currentTypeLabel = currentType?.label ?? typeKey;
  const currentRegionScope = resolveRegionScope(currentType);

  // 種別の読み込み・再読み込みのたびに、保存済みの値で下書きを初期化する
  useEffect(() => {
    if (!currentType) return;
    const scope = resolveRegionScope(currentType);
    setRegionScopeKind(
      scope === "jp" ? "jp" : scope === "world" ? "world" : "country"
    );
    setRegionCountryCode(scope === "jp" || scope === "world" ? "" : scope);
    setWikiLangDraft(resolveWikipediaLang(currentType));
    setCategoriesDraft(resolveCategories(currentType).join("、"));
  }, [currentType]);

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

  const loadRoutes = useCallback(async () => {
    const { data } = await api.routes.list(typeKey);
    setRoutes(data ?? []);
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
    loadRoutes();
    loadSpotTypes();
  }, [hasPageAccess, load, loadRoutes, loadSpotTypes]);

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
        `「${currentTypeLabel}」(${typeKey})の公開スポット${purgeCount}件を削除しますか?` +
          `紐づく訪問記録・訪問予定・口コミ・写真も全ユーザー分削除されます` +
          `(承認待ち・却下・非公開のスポットは残ります)。この操作は取り消せません。`
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

  /**
   * アップロードした exclude.txt 等のテキストからキーの一覧を作る。1行1キーを
   * 基本とし、空行と`#`で始まる行(除外リストのコメント)は無視する。
   */
  const parseDeleteKeys = (text: string) =>
    [
      ...new Set(
        text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"))
      ),
    ];

  const handleDeleteKeysFile = async (file: File) => {
    setDeleteKeysPreview(null);
    setDeleteKeysMessage(null);
    setDeleteKeysFileName(file.name);
    let keys: string[];
    try {
      keys = parseDeleteKeys(await file.text());
    } catch {
      setDeleteKeys([]);
      setDeleteKeysMessage("ファイルの読み込みに失敗しました。");
      return;
    }
    setDeleteKeys(keys);
    if (keys.length === 0) {
      setDeleteKeysMessage("ファイルにキーが1件もありません。");
      return;
    }
    setDeleteKeysChecking(true);
    try {
      const { data, error } = await api.spots.deleteByKeysPreview(typeKey, keys);
      if (error) {
        setDeleteKeysMessage("確認に失敗しました: " + error.message);
        return;
      }
      setDeleteKeysPreview(data ?? null);
    } finally {
      setDeleteKeysChecking(false);
    }
  };

  const handleApplyDeleteKeys = async () => {
    const keys = deleteKeys;
    if (keys.length === 0 || !deleteKeysPreview) return;
    if (deleteKeysPreview.matchedCount === 0) return;
    if (
      !confirm(
        `「${currentTypeLabel}」(${typeKey})の公開スポット` +
          `${deleteKeysPreview.matchedCount}件を削除しますか?` +
          `紐づく訪問記録・訪問予定・口コミ・写真も全ユーザー分削除されます。` +
          `この操作は取り消せません。`
      )
    )
      return;
    setDeleteKeysApplying(true);
    setDeleteKeysMessage(null);
    try {
      const { data, error } = await api.spots.deleteByKeysApply(typeKey, keys);
      if (error) {
        setDeleteKeysMessage("削除に失敗しました: " + error.message);
        return;
      }
      setDeleteKeysMessage(
        `${data?.deletedCount ?? 0}件削除しました` +
          (data?.notFoundKeys.length
            ? `(${data.notFoundKeys.length}件のキーは該当なしのため無視)。`
            : "。")
      );
      setDeleteKeysPreview(null);
      setDeleteKeys([]);
      setDeleteKeysFileName(null);
      load();
    } finally {
      setDeleteKeysApplying(false);
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

  const handleSaveRegionSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentType) return;
    const scope =
      regionScopeKind === "country"
        ? regionCountryCode.trim().toLowerCase()
        : regionScopeKind;
    if (regionScopeKind === "country" && !/^[a-z]{2}$/.test(scope)) {
      setTypeSettingsMessage(
        "国コードはISO 3166-1 alpha-2(例: us、fr)の2文字で入力してください。"
      );
      return;
    }
    const lang = wikiLangDraft.trim().toLowerCase();
    if (!isValidWikipediaLang(lang)) {
      setTypeSettingsMessage(
        "Wikipedia言語は 'ja'・'en' のような言語コードで入力してください。"
      );
      return;
    }
    setSavingRegionSettings(true);
    const { error } = await api.spotTypes.applySettings(currentType.id, {
      [REGION_SCOPE_SETTING_KEY]: scope,
      [WIKIPEDIA_LANG_SETTING_KEY]: lang,
    });
    setSavingRegionSettings(false);
    if (error) {
      setTypeSettingsMessage("対象地域の保存に失敗しました: " + error.message);
      return;
    }
    setTypeSettingsMessage(
      `「${currentType.label}」の対象地域を「${
        scope === "jp" ? "日本" : scope === "world" ? "世界" : countryDisplayName(scope)
      }」、Wikipedia言語を「${lang}」にしました。`
    );
    loadSpotTypes();
  };

  const handleSaveCategories = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentType) return;
    // 読点・カンマのどちらで区切ってもよい。重複と空要素は除いて保存する
    const list = Array.from(
      new Set(
        categoriesDraft
          .split(/[,、]/)
          .map((c) => c.trim())
          .filter((c) => c !== "")
      )
    );
    setSavingCategories(true);
    const { error } = await api.spotTypes.applySettings(currentType.id, {
      [CATEGORIES_SETTING_KEY]: JSON.stringify(list),
    });
    setSavingCategories(false);
    if (error) {
      setTypeSettingsMessage("カテゴリの保存に失敗しました: " + error.message);
      return;
    }
    setTypeSettingsMessage(
      list.length > 0
        ? `「${currentType.label}」のカテゴリを「${list.join("、")}」にしました。`
        : `「${currentType.label}」のカテゴリを未定義(空)にしました。`
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
      const { key, label, settings, series, categories } = parsed.data;

      const { data: created, error } = await api.spotTypes.create(key, label);
      if (error || !created) {
        setTypeMessage("追加に失敗しました: " + (error?.message ?? ""));
        return;
      }

      // series/categoriesが指定されていれば、真偽値の設定と合わせて1回のPATCHで反映する
      // (省略時はDEFAULT_SERIES_STYLES=観光地のA〜E、DEFAULT_CATEGORIES=観光地の
      // カテゴリにフォールバックするので何もしない)
      const settingsToApply: Record<string, boolean | string> = {};
      for (const [k, v] of Object.entries(settings ?? {})) {
        if (v !== undefined) settingsToApply[k] = v;
      }
      if (series) {
        settingsToApply[SERIES_STYLES_SETTING_KEY] = JSON.stringify(series);
      }
      if (categories) {
        settingsToApply[CATEGORIES_SETTING_KEY] = JSON.stringify(categories);
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

  const handleApplyTypeFromJson = async (file: File) => {
    if (!currentType) return;
    setApplyingTypeJson(true);
    setTypeSettingsMessage(null);
    try {
      let json: unknown;
      try {
        json = JSON.parse(await file.text());
      } catch {
        setTypeSettingsMessage("JSONの読み込みに失敗しました(構文エラー)。");
        return;
      }
      const parsed = parseSpotTypeDefinition(json);
      if ("error" in parsed) {
        setTypeSettingsMessage("JSONの内容が不正です: " + parsed.error);
        return;
      }
      const { key, label, settings, series, categories } = parsed.data;
      // キーが変わると種別を差し替えたのと同じ扱いになり影響が大きいため、
      // 一致しない場合は何も反映せずエラーにする(labelは反映してよい)
      if (key !== currentType.key) {
        setTypeSettingsMessage(
          `JSONのkey(${key})が現在の種別のkey(${currentType.key})と一致しません。keyの変更はこの機能では行えません。`
        );
        return;
      }

      const settingsToApply: Record<string, boolean | string> = {};
      for (const [k, v] of Object.entries(settings ?? {})) {
        if (v !== undefined) settingsToApply[k] = v;
      }
      if (series) {
        settingsToApply[SERIES_STYLES_SETTING_KEY] = JSON.stringify(series);
      }
      if (categories) {
        settingsToApply[CATEGORIES_SETTING_KEY] = JSON.stringify(categories);
      }

      const { error: settingsError } = await api.spotTypes.applySettings(
        currentType.id,
        settingsToApply,
        label
      );
      if (settingsError) {
        setTypeSettingsMessage("設定の反映に失敗しました: " + settingsError.message);
        return;
      }

      setTypeSettingsMessage(`「${label}」の設定をJSONの内容に反映しました。`);
      loadSpotTypes();
    } finally {
      setApplyingTypeJson(false);
    }
  };

  // name+lat+lng の完全一致を「同じスポット」とみなす差分更新用のキー
  // (regionはlat/lngから決まる従属値のため含めない — lat/lngが同じでregionだけ
  // 違うデータは想定しない。region表記の修正で別スポット扱いになるのも避けられる)
  const spotDiffKey = (name: string, lat: number, lng: number) =>
    `${name}|${lat}|${lng}`;

  interface CsvSpotRecord {
    key: string | null;
    name: string;
    name_kana: string | null;
    lat: number;
    lng: number;
    region: string;
    series: string | null;
    /** null = CSVにcategories列が無い(既存のカテゴリを触らない) */
    categories: string[] | null;
    description: string | null;
    status: string;
    origin: "csv";
  }

  /**
   * 一括インポートのAPI呼び出しをリトライ付きで実行する。一時的な失敗
   * (開発サーバーの再コンパイル・瞬間的なネットワーク断など)が1回あるだけで
   * 数千件のインポート全体が中断してしまうのを防ぐ。少し待って計3回まで試し、
   * それでも失敗したら最後のエラーを返す(差分インポートは同じ内容を再送しても
   * 二重登録にならないため、成否不明のまま再送しても安全)
   */
  const withRetry = async <T,>(
    run: () => Promise<{ data: T | null; error: { message: string } | null }>
  ): Promise<{ data: T | null; error: { message: string } | null }> => {
    let last = await run();
    for (const delay of [500, 2000]) {
      if (!last.error) return last;
      await new Promise((resolve) => setTimeout(resolve, delay));
      last = await run();
    }
    return last;
  };

  /**
   * スポットCSV(テキスト)を種別targetKeyへ差分インポートする共通処理。
   * このページのCSVインポートとGitHubリポジトリからの取り込みの両方から使う。
   * 検証エラー・途中失敗はErrorをthrowし、成功時は結果メッセージを返す
   */
  const runSpotsCsvImport = async (
    text: string,
    targetKey: string,
    existingSpots: Spot[],
    onProgress: (done: number, total: number) => void
  ): Promise<string> => {
      const rows = parseCsv(text);
      if (rows.length < 2) {
        throw new Error("CSVにデータ行がありません。");
      }
      const header = rows[0].map((h) => h.trim());
      // categories列を持たないCSVは「カテゴリを指定していない」だけなので、
      // 既存スポットのカテゴリを消さずに維持する(key列と同じ扱い)
      const hasCategoriesColumn = header.includes("categories");
      const idx = Object.fromEntries(
        CSV_COLUMNS.map((c) => [c, header.indexOf(c)])
      ) as Record<(typeof CSV_COLUMNS)[number], number>;
      for (const required of ["name", "lat", "lng", "region"] as const) {
        if (idx[required] === -1) {
          throw new Error(`CSVヘッダーに ${required} 列がありません。`);
        }
      }
      const unknownColumns = unknownCsvColumns(header, CSV_COLUMNS);
      if (unknownColumns.length > 0) {
        throw new Error(
          `CSVヘッダーに未対応の列があります: ${unknownColumns.join(", ")}\n` +
            `使える列は ${CSV_COLUMNS.join(", ")} です。` +
            `(rank・category は series・categories に改名されています)`
        );
      }

      const records: CsvSpotRecord[] = [];
      const errors: string[] = [];
      for (let i = 1; i < rows.length; i++) {
        const get = (c: (typeof CSV_COLUMNS)[number]) =>
          idx[c] === -1 ? "" : (rows[i][idx[c]] ?? "").trim();
        const series = get("series") || null;
        // カテゴリはパイプ区切りの1列で複数持てる(例: 自然|夜景|展望)
        const categories = hasCategoriesColumn
          ? parseCategoryList(get("categories"))
          : null;
        const lat = Number(get("lat"));
        const lng = Number(get("lng"));
        if (!get("name")) errors.push(`${i + 1}行目: name が空`);
        else if (Number.isNaN(lat) || Number.isNaN(lng))
          errors.push(`${i + 1}行目: lat/lng が数値でない`);
        else
          records.push({
            key: get("key") || null,
            name: get("name"),
            name_kana: get("name_kana") || null,
            lat,
            lng,
            region: get("region"),
            series,
            categories,
            description: get("description") || null,
            // CSVインポートはこのページ(spot_admin/admin専用)からのみ行えるため、
            // 承認待ちを経由せずそのまま公開する
            status: "published",
            // 登録経路の記録。手動追加(既定'manual')と区別し、還元用エクスポートの
            // 抽出対象から外す
            origin: "csv",
          });
      }
      if (errors.length > 0) {
        throw new Error(
          `エラーがあるためインポートを中止しました:\n` + errors.join("\n")
        );
      }

      // key列はDB側で種別内一意のため、CSV内の重複だけは事前に検出して中止する
      // (どちらの行を正とすべきか決められないため)
      const existingByDiffKey = new Map(
        existingSpots.map((s) => [spotDiffKey(s.name, s.lat, s.lng), s])
      );
      const existingByKey = new Map(
        existingSpots.filter((s) => s.key).map((s) => [s.key as string, s])
      );
      const seenCsvKeys = new Set<string>();
      const keyErrors: string[] = [];
      for (const record of records) {
        if (!record.key) continue;
        if (seenCsvKeys.has(record.key)) {
          keyErrors.push(`key「${record.key}」がCSV内で重複`);
        }
        seenCsvKeys.add(record.key);
      }
      if (keyErrors.length > 0) {
        throw new Error(
          `エラーがあるためインポートを中止しました:\n` + keyErrors.join("\n")
        );
      }

      // 差分更新: 既存行との同一判定はkey一致を最優先し(改名・座標修正もCSVから
      // 反映できるように)、keyで見つからなければname+lat+lngの完全一致で突き合わせる。
      // 一致した既存行は、内容がCSVと異なればCSVの内容で上書きし、同一ならスキップする
      // (同じCSVを何度アップロードしても2回目以降は何も起きない)。ただし公開以外の
      // 既存行(他ユーザーの承認待ち等。編集権限が投稿者本人に限られる)は上書きしない。
      // CSVにkey列が無い場合は既存行のkeyを消さず維持する
      const seenKeys = new Set<string>();
      const newRecords = [];
      const updates: { spot: Spot; record: CsvSpotRecord }[] = [];
      let unchangedCount = 0;
      let untouchableCount = 0;
      const isChanged = (spot: Spot, record: CsvSpotRecord) =>
        spot.name !== record.name ||
        spot.name_kana !== record.name_kana ||
        spot.lat !== record.lat ||
        spot.lng !== record.lng ||
        spot.region !== record.region ||
        spot.series !== record.series ||
        (record.categories !== null &&
          !sameCategories(spot.categories, record.categories)) ||
        spot.description !== record.description ||
        (record.key !== null && spot.key !== record.key) ||
        // 手動追加(manual)の行がCSVと一致した=travel-log-dataへ還元済みなので、
        // 内容が同一でもPATCHしてorigin='csv'に倒す(次回の還元用エクスポートから外す)
        spot.origin !== "csv";
      for (const record of records) {
        const diffKey = spotDiffKey(record.name, record.lat, record.lng);
        const existing =
          (record.key ? existingByKey.get(record.key) : undefined) ??
          existingByDiffKey.get(diffKey);
        if (existing) {
          if (existing.status !== "published") untouchableCount++;
          else if (isChanged(existing, record)) updates.push({ spot: existing, record });
          else unchangedCount++;
          continue;
        }
        if (seenKeys.has(diffKey)) continue; // CSV内でname+lat+lngが重複している行
        seenKeys.add(diffKey);
        newRecords.push(record);
      }

      if (newRecords.length === 0 && updates.length === 0) {
        return `追加・変更はありませんでした(${unchangedCount}件は既存と同一のためスキップ)。`;
      }

      // 1000件ずつ順番に送信し、進捗を表示する(大量データで1リクエストが
      // タイムアウトするのも避けられる)
      const totalCount = newRecords.length + updates.length;
      let insertedCount = 0;
      onProgress(0, totalCount);
      for (
        let offset = 0;
        offset < newRecords.length;
        offset += CSV_IMPORT_CHUNK_SIZE
      ) {
        const chunk = newRecords.slice(offset, offset + CSV_IMPORT_CHUNK_SIZE);
        const { error } = await withRetry(() =>
          api.spots.createMany(chunk, targetKey)
        );
        if (error) {
          throw new Error(
            `${insertedCount}件追加した時点でインポートに失敗しました: ` +
              error.message
          );
        }
        insertedCount += chunk.length;
        onProgress(insertedCount, totalCount);
      }

      // 既存スポットの上書き更新(1件ずつPATCH)。CSVにkeyが無い行は既存のkeyを
      // 消さないよう、keyフィールド自体を送らない(PATCH側が未指定時は維持する)
      let updatedCount = 0;
      for (const { spot, record } of updates) {
        const { error } = await withRetry(() =>
          api.spots.update(spot.id, {
          name: record.name,
          name_kana: record.name_kana,
          lat: record.lat,
          lng: record.lng,
          region: record.region,
          series: record.series,
          ...(record.categories !== null
            ? { categories: record.categories }
            : {}),
          description: record.description,
          ...(record.key !== null ? { key: record.key } : {}),
          origin: record.origin,
          })
        );
        if (error) {
          throw new Error(
            `${insertedCount}件追加・${updatedCount}件更新した時点で失敗しました: ` +
              error.message
          );
        }
        updatedCount++;
        onProgress(insertedCount + updatedCount, totalCount);
      }

      return (
        `${insertedCount}件追加・${updatedCount}件更新しました` +
        (unchangedCount > 0 ? `(${unchangedCount}件は既存と同一のためスキップ)` : "") +
        (untouchableCount > 0
          ? `(${untouchableCount}件は公開以外のスポットのため未変更)`
          : "") +
        "。"
      );
  };

  const handleCsvFile = async (file: File) => {
    setImporting(true);
    setMessage(null);
    try {
      const result = await runSpotsCsvImport(
        await file.text(),
        typeKey,
        spots,
        (done, total) => setImportProgress({ done, total })
      );
      setMessage(result);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      setImportProgress(null);
      // 途中まで追加された場合もあるため、成否によらず一覧を取り直す
      load();
    }
  };

  /**
   * travel-log-dataへの還元用エクスポート。画面から手動追加された公開スポット
   * (origin='manual'。spots.csvへの収録候補)と、画面から個別削除されたCSV由来の
   * 公開スポット(削除の墓標。exclude.txtへの追記候補)を1つのMarkdownにまとめて
   * ダウンロードする。還元作業はClaude Code等が読む前提のため、インポータで
   * 機械的に読み込める形式にはしていない(人間/AIが読める整理を優先)
   */
  const handleExportManualSpots = async () => {
    setExportingManual(true);
    setManualExportMessage(null);
    try {
      const { data: deletions, error } = await api.spotDeletions.list(typeKey);
      if (error) {
        setManualExportMessage("削除の記録の取得に失敗しました: " + error.message);
        return;
      }
      const manualSpots = spots.filter(
        (s) => s.origin === "manual" && s.status === "published"
      );
      const deleted = deletions ?? [];
      if (manualSpots.length === 0 && deleted.length === 0) {
        setManualExportMessage(
          "還元する対象がありません(手動追加された公開スポット・画面から削除されたCSV由来のスポットのどちらも0件)。"
        );
        return;
      }

      const now = new Date();
      const dateKey = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
      const spotsCsv = buildCsv([
        ["name", "name_kana", "lat", "lng", "region", "series", "categories", "description"],
        ...manualSpots.map((s) => [
          s.name,
          s.name_kana,
          s.lat,
          s.lng,
          s.region,
          s.series,
          formatCategoryList(s.categories),
          s.description,
        ]),
      ]).trimEnd();
      const excludeKeys = deleted.map((d) => d.key ?? d.name).join("\n");
      const md = [
        `# travel-log-data 還元用エクスポート`,
        ``,
        `- スポット種別: \`${typeKey}\``,
        `- エクスポート日時: ${now.toLocaleString("ja-JP")}`,
        `- 画面から手動追加された公開スポットと、画面から個別削除されたCSV由来の公開スポットの一覧。`,
        `  travel-log-data への還元(スポットCSVへの収録・exclude.txt への追記)に使う`,
        ``,
        `## 手動追加された公開スポット(${manualSpots.length}件)`,
        ``,
        ...(manualSpots.length === 0
          ? [`なし。`]
          : [
              `スポットCSVへの追加候補。key列は付けていないので、travel-log-data側の規則`,
              `(スポット名、重複時のみ連番サフィックス)で収録時に振ること。`,
              ``,
              "```csv",
              spotsCsv,
              "```",
            ]),
        ``,
        `## 画面から削除されたCSV由来の公開スポット(${deleted.length}件)`,
        ``,
        ...(deleted.length === 0
          ? [`なし。`]
          : [
              `スポットCSVから該当行を消し、exclude.txt に以下のキーを追記する`,
              `(key未設定だったスポットは名前で載せている)。`,
              ``,
              "```",
              excludeKeys,
              "```",
              ``,
              `詳細:`,
              ``,
              ...deleted.map(
                (d) =>
                  `- ${d.name}(key: ${d.key ?? "未設定"}、${d.region}、lat: ${d.lat}、lng: ${d.lng}、削除日時: ${new Date(d.created_at).toLocaleString("ja-JP")})`
              ),
            ]),
        ``,
      ].join("\n");

      const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${typeKey}_feedback_${dateKey}.md`;
      a.click();
      URL.revokeObjectURL(url);
      setManualExportMessage(
        `エクスポートしました(追加候補${manualSpots.length}件・削除候補${deleted.length}件)。`
      );
    } finally {
      setExportingManual(false);
    }
  };

  /**
   * ルートCSV(テキスト)を種別targetKeyへ差分インポートする共通処理。
   * このページのルートCSVインポートとGitHubリポジトリからの取り込みの両方から使う。
   * 検証エラー・失敗はErrorをthrowし、成功時は結果メッセージを返す
   */
  const runRouteCsvImport = async (
    text: string,
    targetKey: string,
    targetSpots: Spot[],
    existingRoutes: SpotRoute[]
  ): Promise<string> => {
      const rows = parseCsv(text);
      if (rows.length < 2) {
        throw new Error("CSVにデータ行がありません。");
      }
      const header = rows[0].map((h) => h.trim());
      const idx = Object.fromEntries(
        ROUTE_CSV_COLUMNS.map((c) => [c, header.indexOf(c)])
      ) as Record<(typeof ROUTE_CSV_COLUMNS)[number], number>;
      for (const required of ["route", "seq", "spot_key"] as const) {
        if (idx[required] === -1) {
          throw new Error(`CSVヘッダーに ${required} 列がありません。`);
        }
      }
      const unknownColumns = unknownCsvColumns(header, ROUTE_CSV_COLUMNS);
      if (unknownColumns.length > 0) {
        throw new Error(
          `CSVヘッダーに未対応の列があります: ${unknownColumns.join(", ")}\n` +
            `使える列は ${ROUTE_CSV_COLUMNS.join(", ")} です。`
        );
      }

      // spot_keyはスポットのkey列(種別内一意)を指す。先に全行を検証してから送る
      const spotsByKey = new Map(
        targetSpots.filter((s) => s.key).map((s) => [s.key as string, s])
      );
      const errors: string[] = [];
      const grouped = new Map<
        string,
        { seq: number; spotId: string; legDescription: string | null }[]
      >();
      // series・descriptionはルート単位の値だが、CSVは行単位なので同じrouteの
      // 各行に同じ値が並ぶ。最初に現れた値を採り、同一route内で食い違う行はエラーにする
      // (leg_descriptionだけは行単位の値=その行のスポットから次のスポットへの区間の説明)
      const seriesByRoute = new Map<string, string | null>();
      const descriptionByRoute = new Map<string, string | null>();
      const seenSeq = new Set<string>();
      for (let i = 1; i < rows.length; i++) {
        const get = (c: (typeof ROUTE_CSV_COLUMNS)[number]) =>
          idx[c] === -1 ? "" : (rows[i][idx[c]] ?? "").trim();
        const route = get("route");
        const series = get("series") || null;
        const description = get("description") || null;
        const legDescription = get("leg_description") || null;
        const seq = Number(get("seq"));
        const spotKey = get("spot_key");
        if (route && seriesByRoute.has(route) && seriesByRoute.get(route) !== series) {
          errors.push(`${i + 1}行目: route「${route}」のseriesが他の行と食い違う`);
        }
        if (
          route &&
          descriptionByRoute.has(route) &&
          descriptionByRoute.get(route) !== description
        ) {
          errors.push(`${i + 1}行目: route「${route}」のdescriptionが他の行と食い違う`);
        }
        if (!route) errors.push(`${i + 1}行目: route が空`);
        else if (!Number.isFinite(seq)) errors.push(`${i + 1}行目: seq が数値でない`);
        else if (!spotKey) errors.push(`${i + 1}行目: spot_key が空`);
        else if (!spotsByKey.has(spotKey))
          errors.push(
            `${i + 1}行目: spot_key「${spotKey}」のスポットが存在しない(スポットCSVを先にインポートする)`
          );
        else if (seenSeq.has(`${route}|${seq}`))
          errors.push(`${i + 1}行目: route「${route}」の seq ${seq} が重複`);
        else {
          seenSeq.add(`${route}|${seq}`);
          if (!seriesByRoute.has(route)) seriesByRoute.set(route, series);
          if (!descriptionByRoute.has(route)) descriptionByRoute.set(route, description);
          const list = grouped.get(route) ?? [];
          list.push({ seq, spotId: spotsByKey.get(spotKey)!.id, legDescription });
          grouped.set(route, list);
        }
      }
      for (const [route, list] of grouped) {
        if (list.length < 2) errors.push(`route「${route}」の経由地が1件しかない`);
        // leg_descriptionは「その行のスポットから次のスポットへの区間」の説明のため、
        // 次の区間が無い最終地点に書かれていたら気づけるようエラーにする
        // (1つ前の行に書くつもりの値のずれを黙って捨てない)
        const last = [...list].sort((a, b) => a.seq - b.seq)[list.length - 1];
        if (last?.legDescription) {
          errors.push(
            `route「${route}」の最終地点(seq ${last.seq})に leg_description があるが、` +
              `最後の地点から先の区間は無い(区間の説明は出発側の行に書く)`
          );
        }
      }
      if (errors.length > 0) {
        throw new Error(
          `エラーがあるためインポートを中止しました:\n` + errors.join("\n")
        );
      }

      // 差分更新: 既存ルートとシリーズ・説明・経由地(区間の説明含む)の並びが完全一致する
      // ものはスキップし、変わったもの・新規のものだけを送る(送った分はルート単位で丸ごと
      // 置き換え)。スポットのCSVインポートと同じく常にstatus: 'published'を明示するため、
      // 公開以外の既存ルートは内容が同一でも公開に倒す(スキップしない)
      const pointsKey = (
        points: { spot_id: string; description: string | null }[]
      ) => JSON.stringify(points.map((p) => [p.spot_id, p.description ?? null]));
      const existingByName = new Map(
        existingRoutes.map((r) => [
          r.name,
          {
            series: r.series,
            description: r.description,
            status: r.status,
            pointsKey: pointsKey(r.points),
          },
        ])
      );
      const changed: {
        name: string;
        series: string | null;
        description: string | null;
        status: "published";
        points: { spot_id: string; description: string | null }[];
      }[] = [];
      let unchangedCount = 0;
      for (const [route, list] of grouped) {
        const points = list
          .sort((a, b) => a.seq - b.seq)
          .map((p) => ({ spot_id: p.spotId, description: p.legDescription }));
        const series = seriesByRoute.get(route) ?? null;
        const description = descriptionByRoute.get(route) ?? null;
        const existing = existingByName.get(route);
        if (
          existing?.pointsKey === pointsKey(points) &&
          existing.series === series &&
          existing.description === description &&
          existing.status === "published"
        ) {
          unchangedCount++;
          continue;
        }
        changed.push({
          name: route,
          series,
          description,
          status: "published",
          points,
        });
      }
      if (changed.length === 0) {
        return `変更はありませんでした(${unchangedCount}本は既存と同一のためスキップ)。`;
      }

      const { error } = await withRetry(() =>
        api.routes.replace(targetKey, changed)
      );
      if (error) {
        throw new Error("インポートに失敗しました: " + error.message);
      }
      return (
        `${changed.length}本のルートを追加・更新しました` +
        (unchangedCount > 0
          ? `(${unchangedCount}本は既存と同一のためスキップ)。`
          : "。")
      );
  };

  const handleRouteCsvFile = async (file: File) => {
    setImportingRoutes(true);
    setRouteMessage(null);
    try {
      setRouteMessage(
        await runRouteCsvImport(await file.text(), typeKey, spots, routes)
      );
      loadRoutes();
    } catch (err) {
      setRouteMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingRoutes(false);
    }
  };

  /**
   * GitHubリポジトリの生ファイルを取得する。無いファイル(404)はnull、
   * それ以外の失敗はErrorをthrowする。ブランチはリポジトリの既定を仮定してmain固定
   */
  const fetchGithubFile = async (
    repo: string,
    path: string
  ): Promise<string | null> => {
    let res: Response;
    try {
      res = await fetch(
        `https://raw.githubusercontent.com/${repo}/main/${path}`
      );
    } catch {
      throw new Error(`${path} の取得に失敗しました(ネットワークエラー)。`);
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`${path} の取得に失敗しました(HTTP ${res.status})。`);
    }
    return await res.text();
  };

  /**
   * settings.json(パース済みJSON)をスポット種別へ適用する。keyと一致する種別が
   * 無ければ作成し、あればlabel・設定・シリーズ・カテゴリを上書きする(GitHub取り込み用)
   */
  const applyTypeDefinition = async (
    json: unknown,
    folderKey: string
  ): Promise<{ label: string; created: boolean }> => {
    const parsed = parseSpotTypeDefinition(json);
    if ("error" in parsed) {
      throw new Error("settings.json の内容が不正です: " + parsed.error);
    }
    const { key, label, settings, series, categories } = parsed.data;
    // フォルダ名と食い違うJSONを黙って適用すると別の種別を上書きしてしまうため中止する
    if (key !== folderKey) {
      throw new Error(
        `settings.json のkey(${key})がフォルダ名(${folderKey})と一致しません。`
      );
    }

    const settingsToApply: Record<string, boolean | string> = {};
    for (const [k, v] of Object.entries(settings ?? {})) {
      if (v !== undefined) settingsToApply[k] = v;
    }
    if (series) {
      settingsToApply[SERIES_STYLES_SETTING_KEY] = JSON.stringify(series);
    }
    if (categories) {
      settingsToApply[CATEGORIES_SETTING_KEY] = JSON.stringify(categories);
    }

    // この画面を開いた後に作られた種別も拾えるよう、最新の一覧から探す
    const { data: types, error: listError } = await withRetry(() =>
      api.spotTypes.list()
    );
    if (listError) {
      throw new Error("種別一覧の取得に失敗しました: " + listError.message);
    }
    const existing = (types ?? []).find((t) => t.key === folderKey);
    if (existing) {
      const { error } = await withRetry(() =>
        api.spotTypes.applySettings(existing.id, settingsToApply, label)
      );
      if (error) throw new Error("設定の反映に失敗しました: " + error.message);
      return { label, created: false };
    }
    // 作成のリトライは「1回目が実は成功していた」場合に2回目がキー重複エラーに
    // なり得るため、リトライ後も失敗していたら既存を引き直して救済する
    const { data: created, error: createError } = await withRetry(() =>
      api.spotTypes.create(key, label)
    );
    let typeId = created?.id ?? null;
    if (createError || !typeId) {
      const { data: retryTypes } = await api.spotTypes.list();
      typeId = (retryTypes ?? []).find((t) => t.key === folderKey)?.id ?? null;
      if (!typeId) {
        throw new Error(
          "種別の作成に失敗しました: " + (createError?.message ?? "")
        );
      }
    }
    if (Object.keys(settingsToApply).length > 0) {
      const { error } = await withRetry(() =>
        api.spotTypes.applySettings(typeId, settingsToApply)
      );
      if (error) {
        throw new Error(
          `種別「${label}」は作成しましたが、設定の反映に失敗しました: ` +
            error.message
        );
      }
    }
    return { label, created: true };
  };

  /**
   * exclude.txt(削除キー一覧)を種別targetKeyへ適用する(GitHub取り込み用)。
   * 「キー一覧を指定して削除」と同じAPIで、削除前に件数を確認ダイアログで確かめる
   */
  const applyExcludeKeys = async (
    text: string,
    targetKey: string,
    targetLabel: string
  ): Promise<string> => {
    const keys = parseDeleteKeys(text);
    if (keys.length === 0) return "キーが1件も無いためスキップ。";
    const { data: preview, error } = await withRetry(() =>
      api.spots.deleteByKeysPreview(targetKey, keys)
    );
    if (error) throw new Error("削除対象の確認に失敗しました: " + error.message);
    if (!preview || preview.matchedCount === 0) {
      return "該当する公開スポットが無いためスキップ。";
    }
    if (
      !confirm(
        `exclude.txt に基づき「${targetLabel}」(${targetKey})の公開スポット` +
          `${preview.matchedCount}件を削除します。` +
          `紐づく訪問記録・訪問予定・口コミ・写真も全ユーザー分削除されます。` +
          `よろしいですか?(キャンセルしても他のファイルの適用は続行します)`
      )
    ) {
      return "削除はキャンセルされました。";
    }
    const { data, error: applyError } = await withRetry(() =>
      api.spots.deleteByKeysApply(targetKey, keys)
    );
    if (applyError) {
      throw new Error("削除に失敗しました: " + applyError.message);
    }
    return (
      `${data?.deletedCount ?? 0}件削除しました` +
      (data?.notFoundKeys.length
        ? `(${data.notFoundKeys.length}件のキーは該当なしのため無視)。`
        : "。")
    );
  };

  /** リポジトリ直下のcatalog.json(スポット種別の一覧)を取得して表示する */
  const handleGithubOpen = async (e: React.FormEvent) => {
    e.preventDefault();
    const repo = githubRepo.trim();
    if (!repo) return;
    setGithubOpening(true);
    setGithubMessage(null);
    setGithubCatalog(null);
    try {
      const text = await fetchGithubFile(repo, "catalog.json");
      if (text === null) {
        throw new Error(
          "catalog.json がリポジトリに見つかりません(travel-log-data形式のリポジトリか確認してください)。"
        );
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error("catalog.json の読み込みに失敗しました(構文エラー)。");
      }
      const spotTypesRaw = (json as { spot_types?: unknown }).spot_types;
      const entries = Array.isArray(spotTypesRaw)
        ? spotTypesRaw.filter(
            (t): t is { key: string; label: string } =>
              !!t &&
              typeof (t as { key?: unknown }).key === "string" &&
              typeof (t as { label?: unknown }).label === "string"
          )
        : [];
      if (entries.length === 0) {
        throw new Error("catalog.json にスポット種別が1件もありません。");
      }
      setGithubCatalog(entries);
    } catch (err) {
      setGithubMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setGithubOpening(false);
    }
  };

  /**
   * カタログで選んだスポット種別のフォルダから settings.json・spots.csv・
   * exclude.txt・routes.csv を取得して順に適用する。種別が無ければ作成、あれば上書き。
   * 途中で失敗してもそこまでの結果を表示する
   */
  const handleGithubApply = async (entry: { key: string; label: string }) => {
    const repo = githubRepo.trim();
    const key = entry.key;
    if (
      !confirm(
        `「${repo}」から「${entry.label}」(${key})のデータを取得して適用します。` +
          `スポット種別が無ければ作成し、あれば設定・スポット・ルートを上書きします。` +
          `よろしいですか?`
      )
    )
      return;
    setGithubImporting(true);
    setGithubMessage(null);
    const lines: string[] = [];
    try {
      setGithubProgress("リポジトリからファイルを取得中…");
      const [settingsText, spotsText, excludeText, routesText] =
        await Promise.all([
          fetchGithubFile(repo, `${key}/settings.json`),
          fetchGithubFile(repo, `${key}/spots.csv`),
          // exclude.txt の置き場所は travel-log-data の規則(excluded_candidates/)
          fetchGithubFile(repo, `${key}/excluded_candidates/exclude.txt`),
          fetchGithubFile(repo, `${key}/routes.csv`),
        ]);
      if (!settingsText) {
        throw new Error(
          `${key}/settings.json がリポジトリに見つかりません。`
        );
      }

      // 1. settings.json → 種別の作成または設定の上書き
      setGithubProgress("スポット種別の設定を適用中…");
      let settingsJson: unknown;
      try {
        settingsJson = JSON.parse(settingsText);
      } catch {
        throw new Error("settings.json の読み込みに失敗しました(構文エラー)。");
      }
      const { label, created } = await applyTypeDefinition(settingsJson, key);
      lines.push(
        created
          ? `settings.json: 種別「${label}」を作成しました。`
          : `settings.json: 種別「${label}」の設定を上書きしました。`
      );

      // 2. spots.csv → 差分インポート(対象種別の既存全件と突き合わせる)
      if (spotsText) {
        setGithubProgress("spots.csv を適用中…");
        const { data: existing, error: listError } = await withRetry(() =>
          api.spots.list(undefined, { type: key })
        );
        if (listError) {
          throw new Error(
            "既存スポットの取得に失敗しました: " + listError.message
          );
        }
        lines.push(
          "spots.csv: " +
            (await runSpotsCsvImport(spotsText, key, existing ?? [], (done, total) =>
              setGithubProgress(`spots.csv を適用中… ${done}/${total}件`)
            ))
        );
      } else {
        lines.push("spots.csv: リポジトリに無いためスキップ。");
      }

      // 3. exclude.txt → CSVから外したスポットの削除(件数確認あり)
      if (excludeText) {
        setGithubProgress("exclude.txt を適用中…");
        lines.push(
          "exclude.txt: " + (await applyExcludeKeys(excludeText, key, label))
        );
      } else {
        lines.push("exclude.txt: リポジトリに無いためスキップ。");
      }

      // 4. routes.csv → スポット取り込み後の最新のkeyで検証してから適用
      if (routesText) {
        setGithubProgress("routes.csv を適用中…");
        const [{ data: freshSpots, error: spotsError }, { data: existingRoutes, error: routesError }] =
          await Promise.all([
            withRetry(() => api.spots.list(undefined, { type: key })),
            withRetry(() => api.routes.list(key)),
          ]);
        if (spotsError || routesError) {
          throw new Error(
            "ルート検証用のデータ取得に失敗しました: " +
              (spotsError?.message ?? routesError?.message ?? "")
          );
        }
        lines.push(
          "routes.csv: " +
            (await runRouteCsvImport(
              routesText,
              key,
              freshSpots ?? [],
              existingRoutes ?? []
            ))
        );
      } else {
        lines.push("routes.csv: リポジトリに無いためスキップ。");
      }

      setGithubMessage("取り込みが完了しました。\n" + lines.join("\n"));
    } catch (err) {
      lines.push(err instanceof Error ? err.message : String(err));
      setGithubMessage("取り込みを中断しました:\n" + lines.join("\n"));
    } finally {
      setGithubImporting(false);
      setGithubProgress(null);
      // 現在表示中の種別へ取り込んだ場合はこの画面の一覧にも反映する
      loadSpotTypes();
      if (key === typeKey) {
        load();
        loadRoutes();
      }
    }
  };

  const handleDeleteRoute = async (route: SpotRoute) => {
    if (
      !confirm(
        `ルート「${route.name}」(経由地${route.points.length}件)を削除しますか?` +
          `スポット自体は削除されません。`
      )
    )
      return;
    const { error } = await api.routes.delete(route.id);
    setRouteMessage(
      error
        ? `「${route.name}」の削除に失敗しました: ` + error.message
        : `「${route.name}」を削除しました。`
    );
    loadRoutes();
  };

  if (checkingRole || !hasPageAccess) return null;

  return (
    <main className="mx-auto max-w-6xl p-4">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-lg font-bold">管理画面</h1>
        {/* 本番で動いているイメージの識別用。GitHub Actionsのビルド時に埋め込まれる */}
        <span className="font-mono text-xs text-gray-500">
          ビルド: {buildNumber ?? "開発ビルド"}
        </span>
      </div>

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
                  placeholder="user@example.com"
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
                <label className="mb-1 block text-sm font-medium">
                  ニックネーム(任意)
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={newUserNickname}
                  onChange={(e) => setNewUserNickname(e.target.value)}
                  placeholder="口コミ等に表示する名前(未設定なら「匿名」)"
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
          <div className="flex flex-col gap-6">
            {isAdmin && currentType && (
              <details>
                <summary className="cursor-pointer select-none text-base font-bold">
                  このスポット種別の管理({currentTypeLabel})
                </summary>
                <section className="mt-2 rounded-xl border border-gray-200 bg-white p-3">
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

                <form
                  onSubmit={handleSaveRegionSettings}
                  className="mt-3 border-t border-gray-100 pt-3"
                >
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                    対象地域とWikipedia言語
                    <HelpTip>
                      対象地域は、地図の地名検索の対象国と、スポットの「地域」欄の扱い
                      (日本=都道府県、国を指定=その国の州・県、世界=国ごと)を決める。
                      Wikipedia言語は、スポット詳細から開くWikipedia検索の言語版
                      (ja・enなどのサブドメイン)。
                    </HelpTip>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={regionScopeKind}
                      onChange={(e) =>
                        setRegionScopeKind(
                          e.target.value as "jp" | "country" | "world"
                        )
                      }
                      className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    >
                      <option value="jp">日本(既定)</option>
                      <option value="country">国を指定</option>
                      <option value="world">世界(国ごと)</option>
                    </select>
                    {regionScopeKind === "country" && (
                      <>
                        <input
                          value={regionCountryCode}
                          onChange={(e) => setRegionCountryCode(e.target.value)}
                          placeholder="国コード(例: fr)"
                          maxLength={2}
                          autoComplete="off"
                          className="w-36 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                        />
                        {/^[a-zA-Z]{2}$/.test(regionCountryCode.trim()) && (
                          <span className="text-xs text-gray-500">
                            = {countryDisplayName(regionCountryCode.trim())}
                          </span>
                        )}
                      </>
                    )}
                    <label className="flex items-center gap-1 text-sm">
                      <span className="text-xs text-gray-500">Wikipedia言語</span>
                      <input
                        value={wikiLangDraft}
                        onChange={(e) => setWikiLangDraft(e.target.value)}
                        placeholder="ja"
                        autoComplete="off"
                        className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={savingRegionSettings}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                    >
                      {savingRegionSettings ? "保存中…" : "保存"}
                    </button>
                  </div>
                </form>

                <form
                  onSubmit={handleSaveCategories}
                  className="mt-3 border-t border-gray-100 pt-3"
                >
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                    カテゴリ
                    <HelpTip>
                      この種別で使うカテゴリの一覧(カンマまたは読点区切り。並び順が
                      そのまま絞り込みチップ・スポット追加時のサジェストの並びになる)。
                      空で保存するとカテゴリ未定義になり、既存スポットに入っている値
                      だけが絞り込み・サジェストに出る。未保存の種別は観光地の
                      カテゴリが既定。カテゴリ自体は自由入力のため、一覧に無い値の
                      スポットもそのまま動く(並びは一覧の後ろになる)。
                    </HelpTip>
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={categoriesDraft}
                      onChange={(e) => setCategoriesDraft(e.target.value)}
                      placeholder="神社仏閣、自然、城、…"
                      autoComplete="off"
                      className="min-w-60 flex-1 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    />
                    <button
                      type="submit"
                      disabled={savingCategories}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                    >
                      {savingCategories ? "保存中…" : "保存"}
                    </button>
                  </div>
                </form>

                <div className="mt-3 border-t border-gray-100 pt-3">
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                    JSONファイルから設定を反映
                    <HelpTip>
                      種別追加時と同じ形式(
                      <code>{"{ key, label, settings?, series?, categories? }"}</code>
                      )のJSONファイルをアップロードすると、label・settings・series・
                      categoriesをまとめてこの種別に反映できる(JSON側で省略した
                      JSONキーの内容は変更しない)。ただしkeyの変更は影響が大きいため、
                      JSONのkeyが現在のkey(
                      <span className="font-mono">{typeKey}</span>
                      )と一致しない場合はエラーにして何も反映しない。
                    </HelpTip>
                  </p>
                  <label className="inline-block cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm">
                    {applyingTypeJson ? "反映中…" : "JSONファイルから反映"}
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="hidden"
                      disabled={applyingTypeJson}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleApplyTypeFromJson(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                </section>
              </details>
            )}

            <details>
              <summary className="cursor-pointer select-none text-base font-bold">
                スポットの管理
              </summary>
              <section className="mt-2 rounded-xl border border-gray-200 bg-white p-3">
              <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-base font-bold">
                CSVインポート
                <HelpTip>
                  個別のスポット追加・編集・削除・承認/却下は、各スポットの詳細画面から行う。
                  ここでは大量データのCSV一括取り込みのみ扱う(取り込んだスポットは最初から公開される)。
                  差分更新: 既存スポットとの同一判定はkey一致を最優先し、keyで見つからなければ
                  name+lat+lngの完全一致で行う。一致した既存行は内容が異なればCSVの内容で
                  上書きし(keyが同じなら改名・座標修正も反映される)、同一ならスキップ、
                  どちらにも一致しなければ新規追加するため、同じCSVを何度アップロードしても
                  重複登録されない(公開以外のスポットに一致した行だけは上書きしない)。
                  CSV列: {CSV_COLUMNS.join(", ")}(name, lat, lng, region は必須。
                  region列にはこの種別の地域(
                  {regionFieldLabel(currentRegionScope)})を入れる。
                  series/categoriesは自由入力で空でも可。categoriesは1スポットに複数
                  付けられ、パイプ区切りで書く(例: 自然|夜景|展望)。keyは省略可の
                  種別内一意な参照キーで、ルートCSVからスポットを指すのに使う)。
                </HelpTip>
              </h3>

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

              </div>

              <div className="mt-3 border-t border-gray-100 pt-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-base font-bold">
                travel-log-dataへの還元用エクスポート
                <HelpTip>
                  画面から手動追加された公開スポット(スポットCSVへの収録候補)と、
                  画面から個別削除されたCSV由来の公開スポット(exclude.txtへの追記候補)を
                  1つのMarkdownファイルにまとめてダウンロードする。還元作業で
                  Claude Code等に渡す前提の形式で、そのまま再インポートはできない。
                  還元後にkeyを付けたCSVを再インポートすると、一致したスポットは
                  CSV由来(還元済み)の扱いに変わり、次回のエクスポートから外れる。
                </HelpTip>
              </h3>

              {manualExportMessage && (
                <p className="mb-3 whitespace-pre-wrap rounded-lg bg-blue-50 p-2 text-sm text-blue-800">
                  {manualExportMessage}
                </p>
              )}

              <button
                type="button"
                onClick={handleExportManualSpots}
                disabled={exportingManual}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {exportingManual ? "エクスポート中…" : "還元用エクスポート"}
              </button>
              </div>

          {isAdmin && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-base font-bold text-red-700">
                キー一覧を指定して削除
                <HelpTip>
                  スポットのキー(CSVの「key」列)を1行に1つ書いたファイル(travel-log-data
                  側の「exclude.txt」をそのままアップロードする想定。空行と「#」で始まる行は
                  無視され、該当が無いキーはエラーにせず読み飛ばす)を選ぶと、一致する公開
                  スポットを削除する。紐づく訪問記録・訪問予定・口コミ・写真は全ユーザー分
                  まとめて削除され、元に戻せない。CSVから外したスポットをDB側からも消すための機能。
                </HelpTip>
              </h3>

              {deleteKeysMessage && (
                <p className="mb-3 whitespace-pre-wrap rounded-lg bg-red-50 p-2 text-sm text-red-800">
                  {deleteKeysMessage}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-block cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm">
                  {deleteKeysChecking ? "確認中…" : "ファイルを選択"}
                  <input
                    type="file"
                    accept=".txt,text/plain"
                    className="hidden"
                    disabled={deleteKeysChecking || deleteKeysApplying}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleDeleteKeysFile(file);
                      e.target.value = "";
                    }}
                  />
                </label>
                {deleteKeysFileName && (
                  <span className="font-mono text-xs text-gray-500">
                    {deleteKeysFileName}({deleteKeys.length}件)
                  </span>
                )}
                {deleteKeysPreview && deleteKeysPreview.matchedCount > 0 && (
                  <button
                    onClick={handleApplyDeleteKeys}
                    disabled={deleteKeysApplying}
                    className="rounded-lg border border-red-400 bg-white px-3 py-1.5 text-sm font-medium text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {deleteKeysApplying
                      ? "削除中…"
                      : `${deleteKeysPreview.matchedCount}件を削除`}
                  </button>
                )}
              </div>

              {deleteKeysPreview && (
                <div className="mt-3 text-sm text-gray-600">
                  <p>
                    ファイル{deleteKeys.length}件のうち、
                    削除対象 {deleteKeysPreview.matchedCount}件
                    {deleteKeysPreview.notFoundKeys.length > 0 &&
                      `(${deleteKeysPreview.notFoundKeys.length}件は該当なし)`}
                    。
                  </p>
                  {deleteKeysPreview.sampleNames.length > 0 && (
                    <p className="mt-1 text-xs text-gray-500">
                      例: {deleteKeysPreview.sampleNames.join("、")}
                      {deleteKeysPreview.matchedCount >
                        deleteKeysPreview.sampleNames.length && " …"}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {isAdmin && (
            <div className="mt-3 border-t border-gray-100 pt-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-base font-bold text-red-700">
                公開スポットの全削除
                <HelpTip>
                  「{currentTypeLabel}」({typeKey})の公開スポットを全件削除する
                  (承認待ち・却下・非公開のスポットは残る)。削除される公開スポットに
                  紐づく訪問記録・訪問予定・口コミ・写真は全ユーザー分まとめて削除され、
                  元に戻せない(ルートも全て削除される)。CSVインポート用データを外部で
                  作り直した際などに、一度空にしてから入れ直す用途を想定。
                </HelpTip>
              </h3>

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
                  対象の公開スポットはありません。
                </p>
              )}
            </div>
          )}

            <div className="mt-3 border-t border-gray-100 pt-3">
              <h3 className="mb-2 flex items-center gap-1.5 text-base font-bold">
                ルート(巡った順の矢印)のインポート
                <HelpTip>
                  スポットを巡った順に矢印で繋ぐルートをCSVで取り込み、地図に表示する。
                  CSV列は {ROUTE_CSV_COLUMNS.join(", ")}(series・description・
                  leg_descriptionは省略可)。
                  routeはルート名、seqは巡った順の番号(ルート内で一意なら飛び番でもよい)、
                  spot_keyはスポットCSVのkey列の値。seriesにこの種別のシリーズ値を入れると、
                  矢印がそのシリーズの縁取り色で描かれ、地図のシリーズ絞り込みにも
                  連動する(表示中のルートの経由地は、スポット自体のシリーズが
                  絞り込みで外れていてもピンが表示される)。descriptionはルート全体の説明文で、
                  地図でルートの線をタップすると出る詳細の先頭に表示される。
                  series・descriptionはルート単位の値なので、同じrouteの行には
                  すべて同じ値を書く(空欄なら既定色・説明なし)。
                  leg_descriptionは行単位の値で、その行のスポットから次のスポットへの
                  区間の説明(移動手段など)。ルート詳細の経由地一覧で2点の間に表示される
                  (次の区間が無い最終地点の行は空欄にする)。
                  差分更新: 既存と同名のルートは
                  シリーズ・説明・経由地を丸ごと置き換え、CSVに無いルートには触らない。
                  取り込みの前に、spot_keyが指すスポットをスポットCSVでインポートして
                  おくこと(key未設定のスポットは参照できない)。
                </HelpTip>
              </h3>

              {routeMessage && (
                <p className="mb-3 whitespace-pre-wrap rounded-lg bg-blue-50 p-2 text-sm text-blue-800">
                  {routeMessage}
                </p>
              )}

              <div className="mb-3">
                <label className="inline-block cursor-pointer rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm">
                  {importingRoutes ? "インポート中…" : "ルートCSVインポート"}
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    disabled={importingRoutes}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleRouteCsvFile(file);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              {routes.length > 0 && (
                <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                  {routes.map((r) => (
                    <li key={r.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="flex-1 truncate text-sm">{r.name}</span>
                      {r.status !== "published" && (
                        <span className="shrink-0 rounded bg-gray-200 px-1.5 py-0.5 text-xs text-gray-600">
                          {STATUS_LABELS[r.status]}
                        </span>
                      )}
                      <span className="shrink-0 text-xs text-gray-500">
                        経由地{r.points.length}件
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteRoute(r)}
                        className="shrink-0 text-xs font-medium text-red-500 underline"
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
              </section>
            </details>

          {isAdmin && (
            <div>
              <h2 className="mb-2 flex items-center gap-1.5 text-base font-bold">
                GitHubリポジトリから取り込み
                <HelpTip>
                  データリポジトリ(travel-log-data形式)の catalog.json から
                  スポット種別の一覧を取得して表示する(mainブランチ)。一覧から
                  種別を選ぶと、そのフォルダの settings.json・spots.csv・
                  exclude.txt・routes.csv が順に適用される。スポット種別が
                  無ければ作成し、あれば設定・スポット・ルートを上書きする
                  (それぞれ個別インポートと同じ差分更新)。exclude.txtによる削除は、
                  削除件数の確認ダイアログにOKしたときだけ実行される。
                </HelpTip>
              </h2>
              <section className="rounded-xl border border-gray-200 bg-white p-3">
                <form
                  onSubmit={handleGithubOpen}
                  className="flex flex-wrap items-end gap-2"
                >
                  <div>
                    <label className="mb-1 block text-xs font-medium">
                      リポジトリ(owner/リポジトリ名)
                    </label>
                    <input
                      required
                      value={githubRepo}
                      onChange={(e) => {
                        setGithubRepo(e.target.value);
                        // 別のリポジトリの一覧が残らないよう、入力を変えたら閉じる
                        setGithubCatalog(null);
                      }}
                      placeholder="rtcode337/travel-log-data"
                      className="w-64 rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={githubOpening || githubImporting}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    {githubOpening ? "取得中…" : "開く"}
                  </button>
                </form>
                {githubCatalog && (
                  <ul className="mt-3 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                    {githubCatalog.map((entry) => (
                      <li
                        key={entry.key}
                        className="flex items-center gap-3 px-3 py-2"
                      >
                        <span className="min-w-0 flex-1 text-sm">
                          {entry.label}{" "}
                          <span className="text-gray-400">({entry.key})</span>
                          {spotTypes.some((t) => t.key === entry.key) ? (
                            <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                              上書き
                            </span>
                          ) : (
                            <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700">
                              新規作成
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          disabled={githubImporting}
                          onClick={() => handleGithubApply(entry)}
                          className="shrink-0 rounded-lg border border-blue-600 px-3 py-1 text-xs font-medium text-blue-600 disabled:opacity-50"
                        >
                          適用
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {githubProgress && (
                  <p className="mt-2 text-sm text-gray-500">{githubProgress}</p>
                )}
                {githubMessage && (
                  <p className="mt-3 whitespace-pre-wrap rounded-lg bg-blue-50 p-2 text-sm text-blue-800">
                    {githubMessage}
                  </p>
                )}
              </section>
            </div>
          )}

          {isAdmin && (
            <div>
              <h2 className="mb-2 flex items-center gap-1.5 text-base font-bold">
                別のスポット種別の管理
                <HelpTip>
                  スポット種別の一覧。種別名をクリックするとそのページに移動する
                  (公開/非公開の切り替えは、移動先の「スポット種別の設定」から行う)。
                  削除は非公開の種別のみ行える
                  (スポットが残っていれば全件削除してから種別自体を削除する)。
                </HelpTip>
              </h2>
              <section className="rounded-xl border border-gray-200 bg-white p-3">
                {typeMessage && (
                  <p className="mb-3 whitespace-pre-wrap rounded-lg bg-blue-50 p-2 text-sm text-blue-800">
                    {typeMessage}
                  </p>
                )}
                <ul className="mb-3 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
                  {spotTypes
                    .map((t) => {
                      const isPublic = getSpotTypeSetting(t, "public_visible");
                      const isCurrent = t.key === typeKey;
                      return (
                        <li key={t.id} className="flex items-center gap-3 px-3 py-2">
                          <span className="flex-1 text-sm">
                            {isCurrent ? (
                              <span>{t.label}</span>
                            ) : (
                              <Link
                                href={`/${t.key}/admin`}
                                className="text-blue-600 underline"
                              >
                                {t.label}
                              </Link>
                            )}{" "}
                            <span className="text-gray-400">({t.key})</span>
                          </span>
                          <span className="w-12 shrink-0 text-xs text-gray-500">
                            {isPublic ? "公開" : "非公開"}
                          </span>
                          <span className="w-10 shrink-0 text-right">
                            {!isPublic && !isCurrent && (
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
                  <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
                    JSONファイルから種別を追加
                    <HelpTip>
                      設定情報込みのJSONファイルからも追加できる
                      (
                      <code>{"{ key, label, settings?, series?, categories? }"}</code>
                      形式。<code>series</code>はそのスポット種別で使えるシリーズの一覧と
                      表示スタイル(色・縁取り線の色・地図ピンの大きさ・ラベル)の配列で、
                      省略すると観光地のA〜Eが既定になる。<code>categories</code>は
                      使うカテゴリの一覧(文字列配列)で、省略すると観光地のカテゴリが
                      既定になる。<code>settings</code>には
                      true/falseの設定のほか、対象地域<code>region_scope</code>
                      ('jp'/国コード/'world')・<code>wikipedia_lang</code>('en'等)も
                      指定できる。travel-log-dataリポジトリの
                      各スポットキーフォルダ内の<code>settings.json</code>を参照)。
                    </HelpTip>
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
              <h2 className="mb-2 flex items-center gap-1.5 text-base font-bold">
                ログイン後に自動で開く種別
                <HelpTip>
                  ログイン後・ルート(/)アクセス時に自動で開く地図/リストの既定(全ユーザー共通)。
                  ここでの選択は既定を切り替えるだけで、他の種別を非表示にするものではない。
                </HelpTip>
              </h2>
              <section className="rounded-xl border border-gray-200 bg-white p-3">
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
