"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import {
  ALLOWED_STATUS_BY_ROLE,
  PREFECTURES,
  STATUS_LABELS,
  distinctValues,
  type Rank,
  type Category,
  type Role,
  type Spot,
  type SpotStatus,
} from "@/lib/types";

export default function AddSpotModal({
  lat,
  lng,
  spot,
  spots,
  role,
  onClose,
  onSaved,
  onDeleted,
}: {
  /** 新規作成時の座標(spotが指定された編集モードでは使わない) */
  lat?: number;
  lng?: number;
  /** 指定すると編集モードになり、フォームに既存の値を読み込む。非公開スポットの
   * 作成者本人のみがこのモードで開ける想定(呼び出し元で権限チェック済み) */
  spot?: Spot;
  /** ランク・カテゴリ入力のサジェスト用に、現在アクティブな種類の既存スポットを渡す */
  spots: Spot[];
  /** 選べるstatusの選択肢を決める(新規作成時のみ使用。nullなら非公開のみ扱う) */
  role: Role | null;
  onClose: () => void;
  onSaved: (spot: Spot) => void;
  onDeleted?: () => void;
}) {
  const isEdit = !!spot;
  const allowedStatuses: SpotStatus[] = role
    ? ALLOWED_STATUS_BY_ROLE[role]
    : ["private"];
  // 新規作成時の初期選択は権限に関わらず常に非公開(モデレーター/管理者も含めて)
  const defaultStatus: SpotStatus = "private";

  const [name, setName] = useState(spot?.name ?? "");
  const [nameKana, setNameKana] = useState(spot?.name_kana ?? "");
  const [prefecture, setPrefecture] = useState(spot?.prefecture ?? "");
  const [municipality, setMunicipality] = useState(spot?.municipality ?? "");
  const [spotLat, setSpotLat] = useState(String(spot?.lat ?? lat ?? ""));
  const [spotLng, setSpotLng] = useState(String(spot?.lng ?? lng ?? ""));
  const [rank, setRank] = useState<Rank>(spot?.rank ?? "");
  const [category, setCategory] = useState<Category>(spot?.category ?? "");
  const [description, setDescription] = useState(spot?.description ?? "");
  const [status, setStatus] = useState<SpotStatus>(defaultStatus);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  // 新規追加時のみ、置いた座標から都道府県・市区町村を自動入力する(手で上書き可能)
  useEffect(() => {
    if (isEdit || lat == null || lng == null) return;
    setLocating(true);
    api.geocode.reverse(lat, lng).then(({ data }) => {
      setLocating(false);
      if (!data) return;
      if (data.prefecture && PREFECTURES.includes(data.prefecture as (typeof PREFECTURES)[number])) {
        setPrefecture((prev) => prev || data.prefecture!);
      }
      if (data.municipality) {
        setMunicipality((prev) => prev || data.municipality!);
      }
    });
  }, []);

  const availableRanks = useMemo(
    () => distinctValues(spots.map((s) => s.rank)),
    [spots]
  );
  const availableCategories = useMemo(
    () => distinctValues(spots.map((s) => s.category)),
    [spots]
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      name_kana: nameKana.trim() || null,
      prefecture,
      municipality: municipality.trim() || null,
      lat: Number(spotLat),
      lng: Number(spotLng),
      rank: rank.trim() || null,
      category: category.trim() || null,
      description: description.trim() || null,
      official_url: spot?.official_url ?? null,
    };
    const { data, error } = isEdit
      ? await api.spots.update(spot!.id, payload)
      : await api.spots.create({ ...payload, status });
    setSaving(false);
    if (error || !data) {
      setError("送信に失敗しました: " + (error?.message ?? "unknown error"));
      return;
    }
    onSaved(data);
  };

  const handleDelete = async () => {
    if (!spot) return;
    if (!confirm(`「${spot.name}」を削除しますか?`)) return;
    setDeleting(true);
    setError(null);
    const { error } = await api.spots.delete(spot.id);
    setDeleting(false);
    if (error) {
      setError("削除に失敗しました: " + error.message);
      return;
    }
    onDeleted?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl"
      >
        <h2 className="font-bold">
          {isEdit ? "非公開スポットを編集" : "この場所にスポットを追加"}
        </h2>
        {!isEdit && (
          <p className="text-xs text-gray-500">
            緯度 {lat!.toFixed(5)} ・ 経度 {lng!.toFixed(5)}
          </p>
        )}
        {isEdit ? (
          <p className="rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
            非公開スポットです。承認待ち・公開になると編集・削除はできなくなります。
          </p>
        ) : allowedStatuses.length > 1 ? (
          <div>
            <label className="mb-1 block text-sm font-medium">状態</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as SpotStatus)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            >
              {allowedStatuses.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              {status === "private" &&
                "非公開: 自分にだけ表示されます。口コミは使えません。"}
              {status === "pending" &&
                "承認待ち: 管理者が承認すると地図に公開されます。"}
              {status === "published" && "公開: すぐに全員の地図に表示されます。"}
            </p>
          </div>
        ) : (
          <p className="rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
            非公開スポットとして追加されます。自分にだけ表示され、口コミは使えません。
          </p>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium">名前 *</label>
          <input
            required
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">よみがな</label>
          <input
            autoComplete="off"
            value={nameKana}
            onChange={(e) => setNameKana(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        {locating && (
          <p className="text-xs text-gray-400">座標から住所を自動取得中…</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-sm font-medium">
              都道府県 *
            </label>
            <select
              required
              value={prefecture}
              onChange={(e) => setPrefecture(e.target.value)}
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
              value={municipality}
              onChange={(e) => setMunicipality(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        {isEdit && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-sm font-medium">緯度 *</label>
              <input
                required
                type="number"
                step="any"
                value={spotLat}
                onChange={(e) => setSpotLat(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">経度 *</label>
              <input
                required
                type="number"
                step="any"
                value={spotLng}
                onChange={(e) => setSpotLng(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
              />
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-sm font-medium">ランク</label>
            <input
              value={rank}
              onChange={(e) => setRank(e.target.value as Rank)}
              list="add-spot-rank-suggestions"
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            />
            <datalist id="add-spot-rank-suggestions">
              {availableRanks.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">カテゴリ</label>
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              list="add-spot-category-suggestions"
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            />
            <datalist id="add-spot-category-suggestions">
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
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={saving || deleting}
            className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving
              ? "送信中…"
              : isEdit
                ? "保存"
                : `${STATUS_LABELS[status]}で送信`}
          </button>
        </div>
        {isEdit && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving || deleting}
            className="w-full rounded-lg border border-red-300 py-2 text-sm text-red-600 disabled:opacity-50"
          >
            {deleting ? "削除中…" : "このスポットを削除"}
          </button>
        )}
      </form>
    </div>
  );
}
