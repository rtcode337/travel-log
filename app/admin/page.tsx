"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseCsv } from "@/lib/csv";
import {
  CATEGORIES,
  PREFECTURES,
  RANKS,
  type Category,
  type Rank,
  type Spot,
} from "@/lib/types";
import RankBadge from "@/components/RankBadge";

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
  rank: "B",
  category: "その他",
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
  const [spots, setSpots] = useState<Spot[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Spot | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SpotForm>(EMPTY_FORM);
  const [message, setMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("spots")
      .select("*")
      .order("prefecture")
      .order("name");
    setSpots((data as Spot[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim();
    if (!q) return spots;
    return spots.filter(
      (s) =>
        s.name.includes(q) ||
        (s.name_kana ?? "").includes(q) ||
        s.prefecture.includes(q)
    );
  }, [spots, search]);

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
      rank: spot.rank,
      category: spot.category,
      description: spot.description ?? "",
      official_url: spot.official_url ?? "",
    });
    setShowForm(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const supabase = createClient();
    const payload = {
      name: form.name.trim(),
      name_kana: form.name_kana.trim() || null,
      prefecture: form.prefecture,
      municipality: form.municipality.trim() || null,
      lat: Number(form.lat),
      lng: Number(form.lng),
      rank: form.rank,
      category: form.category,
      description: form.description.trim() || null,
      official_url: form.official_url.trim() || null,
    };
    if (Number.isNaN(payload.lat) || Number.isNaN(payload.lng)) {
      setMessage("緯度・経度は数値で入力してください。");
      return;
    }
    const { error } = editing
      ? await supabase.from("spots").update(payload).eq("id", editing.id)
      : await supabase.from("spots").insert(payload);
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
    const supabase = createClient();
    const { error } = await supabase.from("spots").delete().eq("id", spot.id);
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
      for (const required of ["name", "prefecture", "lat", "lng", "rank", "category"] as const) {
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
        const rank = get("rank") as Rank;
        const category = get("category") as Category;
        const lat = Number(get("lat"));
        const lng = Number(get("lng"));
        if (!get("name")) errors.push(`${i + 1}行目: name が空`);
        else if (!RANKS.includes(rank))
          errors.push(`${i + 1}行目: rank は S/A/B のいずれか`);
        else if (!CATEGORIES.includes(category))
          errors.push(`${i + 1}行目: category が不正 (${category})`);
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
      const supabase = createClient();
      const { error } = await supabase.from("spots").insert(records);
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

  return (
    <main className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-lg font-bold">管理画面</h1>

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

      <p className="mb-2 text-xs text-gray-400">
        CSV列: {CSV_COLUMNS.join(", ")}(name, prefecture, lat, lng, rank,
        category は必須)
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
                  必訪ランク *
                </label>
                <select
                  value={form.rank}
                  onChange={(e) =>
                    setForm({ ...form, rank: e.target.value as Rank })
                  }
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
                  value={form.category}
                  onChange={(e) =>
                    setForm({ ...form, category: e.target.value as Category })
                  }
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
