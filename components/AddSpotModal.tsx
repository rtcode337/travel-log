"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import {
  CATEGORIES,
  PREFECTURES,
  RANKS,
  type Category,
  type Rank,
  type Spot,
} from "@/lib/types";

export default function AddSpotModal({
  lat,
  lng,
  onClose,
  onCreated,
}: {
  lat: number;
  lng: number;
  onClose: () => void;
  onCreated: (spot: Spot) => void;
}) {
  const [name, setName] = useState("");
  const [nameKana, setNameKana] = useState("");
  const [prefecture, setPrefecture] = useState("");
  const [municipality, setMunicipality] = useState("");
  const [rank, setRank] = useState<Rank>("B");
  const [category, setCategory] = useState<Category>("その他");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const { data, error } = await api.spots.create({
      name: name.trim(),
      name_kana: nameKana.trim() || null,
      prefecture,
      municipality: municipality.trim() || null,
      lat,
      lng,
      rank,
      category,
      description: description.trim() || null,
      official_url: null,
    });
    setSaving(false);
    if (error || !data) {
      setError("送信に失敗しました: " + (error?.message ?? "unknown error"));
      return;
    }
    onCreated(data);
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
        <h2 className="font-bold">この場所にスポットを追加</h2>
        <p className="text-xs text-gray-500">
          緯度 {lat.toFixed(5)} ・ 経度 {lng.toFixed(5)}
        </p>
        <p className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          送信すると承認待ちになります。管理者が承認すると地図に公開されます。
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium">名前 *</label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">よみがな</label>
          <input
            value={nameKana}
            onChange={(e) => setNameKana(e.target.value)}
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
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-sm font-medium">
              必訪ランク *
            </label>
            <select
              value={rank}
              onChange={(e) => setRank(e.target.value as Rank)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            >
              {RANKS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">
              カテゴリ *
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
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
            disabled={saving}
            className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "送信中…" : "承認待ちで送信"}
          </button>
        </div>
      </form>
    </div>
  );
}
