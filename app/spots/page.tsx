"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import { PREFECTURES, type Spot, type Visit } from "@/lib/types";
import FilterBar, {
  DEFAULT_FILTERS,
  passesFilters,
  type SpotFilters,
} from "@/components/FilterBar";
import RankBadge from "@/components/RankBadge";
import SpotDetailModal from "@/components/SpotDetailModal";
import { getRankOrder } from "@/lib/rankStyle";

type SortKey = "rank" | "name" | "visited";

export default function SpotsPage() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [hiddenRanks, setHiddenRanks] = useState<string[]>([]);
  const [hiddenLoaded, setHiddenLoaded] = useState(false);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPref, setSelectedPref] = useState<string | null>(null);
  const [filters, setFilters] = useState<SpotFilters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [detailSpotId, setDetailSpotId] = useState<string | null>(null);

  const loadVisits = useCallback(async () => {
    const { data } = await api.visits.list();
    setVisits(data ?? []);
  }, []);

  // データ取得(既定では hidden_ranks に該当するスポットは取得しない)
  useEffect(() => {
    (async () => {
      const [{ data: spotsData }, { data: activeType }] = await Promise.all([
        api.spots.list("published"),
        api.appSettings.get(),
        loadVisits(),
      ]);
      setSpots(spotsData ?? []);
      setHiddenRanks(activeType?.hidden_ranks ?? []);
      setLoading(false);
    })();
  }, [loadVisits]);

  // ランクフィルタで非表示ランクが明示的に選ばれたら、まだ取得していなければ全件取り直す
  useEffect(() => {
    if (hiddenLoaded || hiddenRanks.length === 0) return;
    if (!filters.ranks.some((r) => hiddenRanks.includes(r))) return;
    setHiddenLoaded(true);
    api.spots.list("published", { includeHidden: true }).then(({ data }) => {
      if (data) setSpots(data);
    });
  }, [filters.ranks, hiddenRanks, hiddenLoaded]);

  const visitedIds = useMemo(
    () => new Set(visits.map((v) => v.spot_id)),
    [visits]
  );

  /** spot_id → 最新訪問日(ソート用) */
  const latestVisitDate = useMemo(() => {
    const m = new Map<string, string>();
    for (const v of visits) {
      const d = v.visited_on ?? "";
      if (!m.has(v.spot_id) || d > (m.get(v.spot_id) ?? "")) {
        m.set(v.spot_id, d);
      }
    }
    return m;
  }, [visits]);

  /** 都道府県ごとの件数(登録があるものだけ、JIS順) */
  const prefectureRows = useMemo(() => {
    const counts = new Map<string, { total: number; visited: number }>();
    for (const spot of spots) {
      const row = counts.get(spot.prefecture) ?? { total: 0, visited: 0 };
      row.total += 1;
      if (visitedIds.has(spot.id)) row.visited += 1;
      counts.set(spot.prefecture, row);
    }
    return PREFECTURES.filter((p) => counts.has(p)).map((p) => ({
      prefecture: p,
      ...counts.get(p)!,
    }));
  }, [spots, visitedIds]);

  const filteredSpots = useMemo(() => {
    const list = spots.filter(
      (s) =>
        s.prefecture === selectedPref &&
        passesFilters(
          filters,
          s.rank,
          s.category,
          visitedIds.has(s.id),
          hiddenRanks
        )
    );
    list.sort((a, b) => {
      switch (sortKey) {
        case "rank":
          return (
            getRankOrder(a.rank) - getRankOrder(b.rank) ||
            (a.name_kana ?? a.name).localeCompare(b.name_kana ?? b.name, "ja")
          );
        case "name":
          return (a.name_kana ?? a.name).localeCompare(
            b.name_kana ?? b.name,
            "ja"
          );
        case "visited": {
          const da = latestVisitDate.get(a.id) ?? "";
          const db = latestVisitDate.get(b.id) ?? "";
          return db.localeCompare(da); // 新しい順、未訪問は最後
        }
      }
    });
    return list;
  }, [
    spots,
    selectedPref,
    filters,
    visitedIds,
    sortKey,
    latestVisitDate,
    hiddenRanks,
  ]);

  if (loading) {
    return (
      <main className="p-4">
        <p className="text-sm text-gray-500">読み込み中…</p>
      </main>
    );
  }

  // 都道府県一覧(ドリルダウンの起点)
  if (!selectedPref) {
    return (
      <main className="mx-auto max-w-lg p-4">
        <h1 className="mb-4 text-lg font-bold">都道府県から探す</h1>
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {prefectureRows.map((row) => (
            <li key={row.prefecture}>
              <button
                onClick={() => setSelectedPref(row.prefecture)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
              >
                <span className="font-medium">{row.prefecture}</span>
                <span className="text-sm text-gray-500">
                  <span className="mr-2 text-green-600">
                    ✓ {row.visited}
                  </span>
                  / {row.total} 件
                </span>
              </button>
            </li>
          ))}
        </ul>
        {prefectureRows.length === 0 && (
          <p className="text-sm text-gray-500">
            スポットが未登録です。管理画面から追加してください。
          </p>
        )}
      </main>
    );
  }

  // スポット一覧
  return (
    <main className="mx-auto max-w-lg p-4">
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => setSelectedPref(null)}
          className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-600"
        >
          ← 都道府県
        </button>
        <h1 className="text-lg font-bold">{selectedPref}</h1>
      </div>

      <div className="mb-3 space-y-2">
        <FilterBar
          spots={spots.filter((s) => s.prefecture === selectedPref)}
          filters={filters}
          onChange={setFilters}
          hiddenRanks={hiddenRanks}
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="rank">ランク順</option>
          <option value="name">名前順</option>
          <option value="visited">訪問日順</option>
        </select>
      </div>

      <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
        {filteredSpots.map((spot) => (
          <li key={spot.id}>
            <button
              onClick={() => setDetailSpotId(spot.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
            >
              <RankBadge rank={spot.rank} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{spot.name}</p>
                <p className="text-xs text-gray-500">
                  {spot.category}
                  {spot.municipality && ` ・ ${spot.municipality}`}
                </p>
              </div>
              {visitedIds.has(spot.id) && (
                <span className="shrink-0 text-green-600">✓</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {filteredSpots.length === 0 && (
        <p className="mt-4 text-sm text-gray-500">
          条件に合うスポットがありません。
        </p>
      )}

      {detailSpotId && (
        <SpotDetailModal
          spotId={detailSpotId}
          onClose={() => setDetailSpotId(null)}
          onVisitChange={loadVisits}
        />
      )}
    </main>
  );
}
