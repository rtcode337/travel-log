"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import {
  PREFECTURES,
  formatVisitedOn,
  type Spot,
  type Visit,
  type VisitPlan,
} from "@/lib/types";
import FilterBar, {
  DEFAULT_FILTERS,
  passesFilters,
  type SpotFilters,
} from "@/components/FilterBar";
import RankBadge from "@/components/RankBadge";
import SpotDetailModal from "@/components/SpotDetailModal";
import { getRankOrder } from "@/lib/rankStyle";

type SortKey = "rank" | "name" | "visited";

const UNKNOWN_MUNICIPALITY = "(市区町村不明)";

export default function SpotsPage() {
  const [spots, setSpots] = useState<Spot[]>([]);
  const [hiddenRanks, setHiddenRanks] = useState<string[]>([]);
  const [hiddenLoaded, setHiddenLoaded] = useState(false);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [visitPlans, setVisitPlans] = useState<VisitPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPref, setSelectedPref] = useState<string | null>(null);
  const [selectedMuni, setSelectedMuni] = useState<string | null>(null);
  const [filters, setFilters] = useState<SpotFilters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [detailSpotId, setDetailSpotId] = useState<string | null>(null);

  const loadVisits = useCallback(async () => {
    const { data } = await api.visits.list();
    setVisits(data ?? []);
  }, []);

  const loadVisitPlans = useCallback(async () => {
    const { data } = await api.visitPlans.list();
    setVisitPlans(data ?? []);
  }, []);

  const loadSpots = useCallback(async () => {
    const { data } = await api.spots.list(
      "published",
      hiddenLoaded ? { includeHidden: true } : undefined
    );
    setSpots(data ?? []);
  }, [hiddenLoaded]);

  // データ取得(既定では hidden_ranks に該当するスポットは取得しない)
  useEffect(() => {
    (async () => {
      const [{ data: spotsData }, { data: activeType }] = await Promise.all([
        api.spots.list("published"),
        api.appSettings.get(),
        loadVisits(),
        loadVisitPlans(),
      ]);
      setSpots(spotsData ?? []);
      setHiddenRanks(activeType?.hidden_ranks ?? []);
      setLoading(false);
    })();
  }, [loadVisits, loadVisitPlans]);

  // ランクフィルタで非表示ランクが明示的に選ばれたら、まだ取得していなければ全件取り直す
  useEffect(() => {
    if (hiddenLoaded || hiddenRanks.length === 0) return;
    if (!filters.ranks.some((r) => hiddenRanks.includes(r))) return;
    setHiddenLoaded(true);
    api.spots.list("published", { includeHidden: true }).then(({ data }) => {
      if (data) setSpots(data);
    });
  }, [filters.ranks, hiddenRanks, hiddenLoaded]);

  const spotById = useMemo(() => {
    const m = new Map<string, Spot>();
    for (const s of spots) m.set(s.id, s);
    return m;
  }, [spots]);

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

  /** 訪問予定(追加した日時が新しい順) */
  const plannedSpots = useMemo(() => {
    return visitPlans
      .filter((p) => spotById.has(p.spot_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((p) => ({ plan: p, spot: spotById.get(p.spot_id)! }));
  }, [visitPlans, spotById]);

  /** 最近訪問した場所(スポット単位で重複排除し、記録日時が新しい順に最大50件) */
  const recentVisits = useMemo(() => {
    const latestBySpot = new Map<string, Visit>();
    for (const v of visits) {
      const prev = latestBySpot.get(v.spot_id);
      if (!prev || v.created_at > prev.created_at) latestBySpot.set(v.spot_id, v);
    }
    return Array.from(latestBySpot.values())
      .filter((v) => spotById.has(v.spot_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 50);
  }, [visits, spotById]);

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

  /** 選択中の都道府県内の市区町村ごとの件数(名前順、市区町村不明は最後) */
  const municipalityRows = useMemo(() => {
    if (!selectedPref) return [];
    const counts = new Map<string, { total: number; visited: number }>();
    for (const spot of spots) {
      if (spot.prefecture !== selectedPref) continue;
      const key = spot.municipality ?? UNKNOWN_MUNICIPALITY;
      const row = counts.get(key) ?? { total: 0, visited: 0 };
      row.total += 1;
      if (visitedIds.has(spot.id)) row.visited += 1;
      counts.set(key, row);
    }
    return Array.from(counts.entries())
      .map(([municipality, v]) => ({ municipality, ...v }))
      .sort((a, b) => {
        if (a.municipality === UNKNOWN_MUNICIPALITY) return 1;
        if (b.municipality === UNKNOWN_MUNICIPALITY) return -1;
        return a.municipality.localeCompare(b.municipality, "ja");
      });
  }, [spots, selectedPref, visitedIds]);

  const filteredSpots = useMemo(() => {
    const list = spots.filter((s) => {
      if (s.prefecture !== selectedPref) return false;
      if ((s.municipality ?? UNKNOWN_MUNICIPALITY) !== selectedMuni) return false;
      return passesFilters(
        filters,
        s.rank,
        s.category,
        visitedIds.has(s.id),
        hiddenRanks
      );
    });
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
    selectedMuni,
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

  // トップ画面: 2カラム(左=最近の訪問、右=都道府県別)
  if (!selectedPref) {
    return (
      <main className="mx-auto max-w-4xl p-4">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <section>
            {plannedSpots.length > 0 && (
              <div className="mb-6">
                <h1 className="mb-4 text-lg font-bold">訪問予定</h1>
                <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
                  {plannedSpots.map(({ plan, spot }) => (
                    <li key={plan.id}>
                      <button
                        onClick={() => setDetailSpotId(spot.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                      >
                        <RankBadge rank={spot.rank} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{spot.name}</p>
                          <p className="text-xs text-gray-500">
                            {spot.prefecture}
                            {spot.municipality && ` ${spot.municipality}`}
                          </p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <h1 className="mb-4 text-lg font-bold">最近の訪問場所</h1>
            {recentVisits.length === 0 ? (
              <p className="text-sm text-gray-500">
                まだ訪問記録がありません。
              </p>
            ) : (
              <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
                {recentVisits.map((visit) => {
                  const spot = spotById.get(visit.spot_id)!;
                  return (
                    <li key={visit.id}>
                      <button
                        onClick={() => setDetailSpotId(spot.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                      >
                        <RankBadge rank={spot.rank} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{spot.name}</p>
                          <p className="text-xs text-gray-500">
                            {spot.prefecture}
                            {spot.municipality && ` ${spot.municipality}`}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-gray-400">
                          {formatVisitedOn(visit.visited_on, visit.date_precision)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section>
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
          </section>
        </div>

        {detailSpotId && (
          <SpotDetailModal
            spotId={detailSpotId}
            spots={spots}
            onClose={() => setDetailSpotId(null)}
            onVisitChange={loadVisits}
            onSpotChange={loadSpots}
            onSpotDeleted={loadSpots}
            onVisitPlanChange={loadVisitPlans}
          />
        )}
      </main>
    );
  }

  // 市区町村一覧(都道府県を選択した直後)
  if (!selectedMuni) {
    return (
      <main className="mx-auto max-w-lg p-4">
        <div className="mb-4 flex items-center gap-2">
          <button
            onClick={() => setSelectedPref(null)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-600"
          >
            ← 都道府県
          </button>
          <h1 className="text-lg font-bold">{selectedPref}</h1>
        </div>
        <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {municipalityRows.map((row) => (
            <li key={row.municipality}>
              <button
                onClick={() => setSelectedMuni(row.municipality)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
              >
                <span className="font-medium">{row.municipality}</span>
                <span className="text-sm text-gray-500">
                  <span className="mr-2 text-green-600">✓ {row.visited}</span>
                  / {row.total} 件
                </span>
              </button>
            </li>
          ))}
        </ul>
      </main>
    );
  }

  // スポット一覧(市区町村まで選択した後)
  return (
    <main className="mx-auto max-w-lg p-4">
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => setSelectedMuni(null)}
          className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-600"
        >
          ← {selectedPref}
        </button>
        <h1 className="text-lg font-bold">{selectedMuni}</h1>
      </div>

      <div className="mb-3 space-y-2">
        <FilterBar
          spots={spots.filter(
            (s) =>
              s.prefecture === selectedPref &&
              (s.municipality ?? UNKNOWN_MUNICIPALITY) === selectedMuni
          )}
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
                <p className="text-xs text-gray-500">{spot.category}</p>
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
          spots={spots}
          onClose={() => setDetailSpotId(null)}
          onVisitChange={loadVisits}
          onSpotChange={loadSpots}
          onSpotDeleted={loadSpots}
          onVisitPlanChange={loadVisitPlans}
        />
      )}
    </main>
  );
}
