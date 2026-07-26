"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import {
  SPOTS_PAGE_SIZE,
  formatVisitedOn,
  type MyReview,
  type Series,
  type Spot,
  type Visit,
  type VisitPlan,
  type VisitPlanList,
} from "@/lib/types";
import {
  compareRegions,
  DEFAULT_REGION_SCOPE,
  regionFieldLabel,
} from "@/lib/region";
import { useRegionScope } from "@/lib/useRegionScope";
import FilterBar, {
  DEFAULT_FILTERS,
  passesFilters,
  type SpotFilters,
} from "@/components/FilterBar";
import SeriesBadge from "@/components/SeriesBadge";
import SpotDetailModal from "@/components/SpotDetailModal";
import VisitPlanListFormModal from "@/components/VisitPlanListFormModal";
import VisitPlanListDetailModal from "@/components/VisitPlanListDetailModal";
import { formatPlanDateRange } from "@/lib/planListDraft";
import SpotDownloadDialogs from "@/components/SpotDownloadDialogs";
import { getSeriesOrder } from "@/lib/seriesStyle";
import SeriesFilter from "@/components/SeriesFilter";
import { useSeriesStyles } from "@/lib/useSeriesStyles";
import { useCategories } from "@/lib/useCategories";
import { formatCategoriesForDisplay } from "@/lib/category";
import { useSpotCache } from "@/lib/useSpotCache";

type SortKey = "series" | "name" | "visited";
type BrowseMode = "region" | "series";

const STATUS_LABELS: Partial<Record<Spot["status"], string>> = {
  private: "非公開",
  pending: "承認待ち",
  rejected: "却下",
};

/** 現在ページを中心に、折り返さない範囲でページ番号を間引く(先頭・末尾は常に表示し、
 * 離れている場合は「…」で省略する) */
function getPageNumbers(page: number, totalPages: number, siblingCount = 1): (number | "…")[] {
  const totalNumbers = siblingCount * 2 + 5;
  if (totalPages <= totalNumbers) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  const leftSibling = Math.max(page - siblingCount, 2);
  const rightSibling = Math.min(page + siblingCount, totalPages - 1);

  const pages: (number | "…")[] = [1];
  if (leftSibling > 2) pages.push("…");
  for (let p = leftSibling; p <= rightSibling; p++) pages.push(p);
  if (rightSibling < totalPages - 1) pages.push("…");
  pages.push(totalPages);
  return pages;
}

function Pager({
  page,
  totalPages,
  loading,
  onChange,
}: {
  page: number;
  totalPages: number;
  loading?: boolean;
  onChange: (page: number) => void;
}) {
  const pageNumbers = useMemo(() => getPageNumbers(page, totalPages), [page, totalPages]);
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between gap-1 text-sm text-gray-500">
      <button
        type="button"
        disabled={page <= 1 || loading}
        onClick={() => onChange(Math.max(1, page - 1))}
        className="shrink-0 rounded-lg border border-gray-300 bg-white px-2.5 py-1 disabled:opacity-40"
      >
        ← 前へ
      </button>
      <div className="flex items-center gap-0.5">
        {pageNumbers.map((p, i) =>
          p === "…" ? (
            <span key={`ellipsis-${i}`} className="px-1 text-gray-400">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              disabled={loading}
              onClick={() => onChange(p)}
              className={`min-w-[1.75rem] rounded-lg px-1.5 py-1 text-xs font-medium ${
                p === page
                  ? "bg-blue-600 text-white"
                  : "border border-gray-300 bg-white hover:bg-gray-50"
              }`}
            >
              {p}
            </button>
          )
        )}
      </div>
      <button
        type="button"
        disabled={page >= totalPages || loading}
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        className="shrink-0 rounded-lg border border-gray-300 bg-white px-2.5 py-1 disabled:opacity-40"
      >
        次へ →
      </button>
    </div>
  );
}

/** 訪問予定・最近の訪問場所・非公開スポット・都道府県別一覧のページング件数
 * (シリーズから探すタブはサーバー側ページング(SPOTS_PAGE_SIZE)を使うため対象外) */
const CLIENT_PAGE_SIZE = 50;

/** 手元に持っている配列(取得済み・全件)をクライアント側でページ分割する */
function usePagedItems<T>(items: T[], pageSize: number) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize]
  );
  return { page: safePage, setPage, totalPages, pageItems, total: items.length };
}

/** 一覧の上に置く、件数表示付きのページャー */
function PagedListHeader({
  page,
  totalPages,
  total,
  loading,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  loading?: boolean;
  onChange: (page: number) => void;
}) {
  return (
    <div className="mb-2">
      <p className="mb-1 text-xs text-gray-500">
        {page} / {totalPages}ページ (全{total}件)
      </p>
      <Pager page={page} totalPages={totalPages} loading={loading} onChange={onChange} />
    </div>
  );
}

/** 一覧の下に置く、件数表示なしのページャー */
function PagedListFooter({
  page,
  totalPages,
  loading,
  onChange,
}: {
  page: number;
  totalPages: number;
  loading?: boolean;
  onChange: (page: number) => void;
}) {
  return (
    <div className="mt-2">
      <Pager page={page} totalPages={totalPages} loading={loading} onChange={onChange} />
    </div>
  );
}

export default function SpotsView({
  spotTypeKey,
}: {
  /** 表示対象のスポット種別キー(常に /[type]/spots から渡される) */
  spotTypeKey: string;
}) {
  // 一覧では未ダウンロード・更新ありの自動確認ダイアログを出さない(地図側でだけ促す。
  // 未ダウンロードのままなら公開スポット抜き=自分のスポットだけの一覧になる)
  const spotCache = useSpotCache(spotTypeKey, { autoPrompt: false });
  const seriesStyles = useSeriesStyles(spotTypeKey);
  // 種別のカテゴリ設定。絞り込みチップの並び順に使う
  const categories = useCategories(spotTypeKey);
  // 種別の対象地域スコープ。地域タブの名称(都道府県/州・県/国)と並び順に使う
  const regionScope = useRegionScope(spotTypeKey) ?? DEFAULT_REGION_SCOPE;
  const regionLabel = regionFieldLabel(regionScope);
  const [privateSpots, setPrivateSpots] = useState<Spot[]>([]);
  const spots = useMemo(
    () => [...(spotCache.publicSpots ?? []), ...privateSpots],
    [spotCache.publicSpots, privateSpots]
  );
  const [visits, setVisits] = useState<Visit[]>([]);
  const [visitPlans, setVisitPlans] = useState<VisitPlan[]>([]);
  const [planLists, setPlanLists] = useState<VisitPlanList[]>([]);
  const [myReviews, setMyReviews] = useState<MyReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null);
  const [filters, setFilters] = useState<SpotFilters>(DEFAULT_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("series");
  const [detailSpotId, setDetailSpotId] = useState<string | null>(null);
  // 訪問予定リストの新規作成モーダル、詳細表示中のリストID
  const [showListForm, setShowListForm] = useState(false);
  // 編集対象の訪問予定リスト(詳細の「編集」から。VisitPlanListFormModalのeditに渡す)
  const [editingList, setEditingList] = useState<VisitPlanList | null>(null);
  const [detailListId, setDetailListId] = useState<string | null>(null);

  const [browseMode, setBrowseMode] = useState<BrowseMode>("series");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [managementItems, setManagementItems] = useState<Spot[]>([]);
  const [managementTotal, setManagementTotal] = useState(0);
  const [managementAvailableSeries, setManagementAvailableSeries] = useState<Series[]>([]);
  const [managementLoaded, setManagementLoaded] = useState(false);
  const [managementLoading, setManagementLoading] = useState(false);
  const [managementSearchInput, setManagementSearchInput] = useState("");
  const [managementSearch, setManagementSearch] = useState("");
  // A〜Eのシリーズはtourist種別専用(CLAUDE.md参照)。それ以外の種別では
  // 「A」を既定にすると該当スポットが無く常に0件表示になるため、すべて(空配列)を既定にする
  const [managementSeries, setManagementSeries] = useState<Series[]>(
    spotTypeKey === "tourist" ? ["A"] : []
  );
  const [managementPage, setManagementPage] = useState(1);

  const loadManagementSpots = useCallback(async () => {
    setManagementLoading(true);
    const { data } = await api.spots.listPage({
      type: spotTypeKey,
      page: managementPage,
      search: managementSearch || undefined,
      series: managementSeries,
    });
    if (data) {
      setManagementItems(data.items);
      setManagementTotal(data.total);
      setManagementAvailableSeries(
        [...data.availableSeries].sort(
          (a, b) => getSeriesOrder(a, seriesStyles) - getSeriesOrder(b, seriesStyles)
        )
      );
    }
    setManagementLoaded(true);
    setManagementLoading(false);
  }, [spotTypeKey, managementPage, managementSearch, managementSeries, seriesStyles]);

  useEffect(() => {
    if (browseMode === "series") loadManagementSpots();
  }, [browseMode, loadManagementSpots]);

  const handleManagementSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setManagementPage(1);
    setManagementSearch(managementSearchInput.trim());
  };

  const handleManagementSeriesChange = (series: Series[]) => {
    setManagementSeries(series);
    setManagementPage(1);
  };

  const handleManagementPageChange = (page: number) => {
    setManagementPage(page);
  };

  const managementTotalPages = Math.max(1, Math.ceil(managementTotal / SPOTS_PAGE_SIZE));

  const loadVisits = useCallback(async () => {
    const { data } = await api.visits.list();
    setVisits(data ?? []);
  }, []);

  const loadVisitPlans = useCallback(async () => {
    const { data } = await api.visitPlans.list();
    setVisitPlans(data ?? []);
  }, []);

  const loadPlanLists = useCallback(async () => {
    const { data } = await api.visitPlanLists.list(spotTypeKey);
    setPlanLists(data ?? []);
  }, [spotTypeKey]);

  const loadMyReviews = useCallback(async () => {
    const { data } = await api.reviews.listMine(spotTypeKey);
    setMyReviews(data ?? []);
  }, [spotTypeKey]);

  // 公開スポットはIndexedDBの明示ダウンロードキャッシュ(spotCache)から得るため、
  // ここでは自分の非公開スポットだけをAPIから取り直す
  const loadPrivateSpots = useCallback(async () => {
    const { data } = await api.spots.list("private", { type: spotTypeKey });
    setPrivateSpots(data ?? []);
  }, [spotTypeKey]);

  /** スポットの詳細画面での編集・承認・却下後、表示中のモードに応じて取り直す
   * (公開スポットキャッシュはこの端末で直接変更した1件だけをその場で反映する) */
  const refreshAfterSpotChange = useCallback(
    (spot: Spot) => {
      spotCache.applySpotChange(spot);
      loadPrivateSpots();
      if (managementLoaded) loadManagementSpots();
    },
    [spotCache, loadPrivateSpots, managementLoaded, loadManagementSpots]
  );

  /** スポットの詳細画面での削除後、表示中のモードに応じて取り直す */
  const refreshAfterSpotDelete = useCallback(
    (spotId: string) => {
      spotCache.applySpotDelete(spotId);
      loadPrivateSpots();
      if (managementLoaded) loadManagementSpots();
    },
    [spotCache, loadPrivateSpots, managementLoaded, loadManagementSpots]
  );

  // データ取得
  useEffect(() => {
    (async () => {
      await Promise.all([
        loadPrivateSpots(),
        loadVisits(),
        loadVisitPlans(),
        loadPlanLists(),
        loadMyReviews(),
      ]);
      setLoading(false);
    })();
  }, [
    loadPrivateSpots,
    loadVisits,
    loadVisitPlans,
    loadPlanLists,
    loadMyReviews,
    spotTypeKey,
  ]);

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

  /** 自分が追加した非公開スポット(新しい順) */
  const myPrivateSpots = useMemo(() => {
    return spots
      .filter((s) => s.status === "private")
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [spots]);

  /** 最近訪問した場所(スポット単位で重複排除し、訪問日時が新しい順。訪問日時が
   * 「覚えていない」等でnullのものは最後になる) */
  const recentVisits = useMemo(() => {
    const latestBySpot = new Map<string, Visit>();
    for (const v of visits) {
      const prev = latestBySpot.get(v.spot_id);
      if (!prev || (v.visited_on ?? "") > (prev.visited_on ?? "")) {
        latestBySpot.set(v.spot_id, v);
      }
    }
    return Array.from(latestBySpot.values())
      .filter((v) => spotById.has(v.spot_id))
      .sort((a, b) => (b.visited_on ?? "").localeCompare(a.visited_on ?? ""));
  }, [visits, spotById]);

  /** 地域(都道府県/州・県/国)ごとの件数。登録がある地域だけを、'jp'はJIS順・
   * それ以外は五十音順に並べる(スコープ外の値も消さず末尾に出す。compareRegions参照) */
  const regionRows = useMemo(() => {
    const counts = new Map<string, { total: number; visited: number }>();
    for (const spot of spots) {
      const row = counts.get(spot.region) ?? { total: 0, visited: 0 };
      row.total += 1;
      if (visitedIds.has(spot.id)) row.visited += 1;
      counts.set(spot.region, row);
    }
    return Array.from(counts.keys())
      .sort((a, b) => compareRegions(a, b, regionScope))
      .map((p) => ({ region: p, ...counts.get(p)! }));
  }, [spots, visitedIds, regionScope]);

  const filteredSpots = useMemo(() => {
    const list = spots.filter((s) => {
      if (s.region !== selectedRegion) return false;
      return passesFilters(filters, s.series, s.categories, visitedIds.has(s.id));
    });
    list.sort((a, b) => {
      switch (sortKey) {
        case "series":
          return (
            getSeriesOrder(a.series, seriesStyles) - getSeriesOrder(b.series, seriesStyles) ||
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
    selectedRegion,
    filters,
    visitedIds,
    sortKey,
    latestVisitDate,
    seriesStyles,
  ]);

  const plannedPager = usePagedItems(plannedSpots, CLIENT_PAGE_SIZE);
  const recentVisitsPager = usePagedItems(recentVisits, CLIENT_PAGE_SIZE);
  const myReviewsPager = usePagedItems(myReviews, CLIENT_PAGE_SIZE);
  const privateSpotsPager = usePagedItems(myPrivateSpots, CLIENT_PAGE_SIZE);
  const filteredSpotsPager = usePagedItems(filteredSpots, CLIENT_PAGE_SIZE);
  const { setPage: setFilteredPage } = filteredSpotsPager;
  useEffect(() => {
    setFilteredPage(1);
  }, [selectedRegion, filters, sortKey, setFilteredPage]);

  // この種別の自分の訪問記録(メモ+スポット情報のCSVと添付写真)のZIPエクスポート。
  // ZIPバイナリのためapi-client(JSON前提)を使わず直接fetchし、
  // blob化してからaタグのdownloadで保存させる
  const handleExportVisits = async () => {
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch(
        `/api/visits/export?type=${encodeURIComponent(spotTypeKey)}`
      );
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const filename =
        res.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] ?? "travel-log-visits.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("エクスポートに失敗しました。");
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <main className="p-4">
        <p className="text-sm text-gray-500">読み込み中…</p>
      </main>
    );
  }

  // トップ画面: 2カラム(左=最近の訪問、右=都道府県別)
  if (!selectedRegion) {
    return (
      <>
      <main className="mx-auto max-w-4xl p-4">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <section>
            {/* 訪問予定(個別のブックマーク)。0件のときは出さない */}
            {plannedSpots.length > 0 && (
              <div className="mb-6">
                <h1 className="mb-4 text-lg font-bold">訪問予定</h1>
                <PagedListHeader
                  page={plannedPager.page}
                  totalPages={plannedPager.totalPages}
                  total={plannedPager.total}
                  onChange={plannedPager.setPage}
                />
                <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
                  {plannedPager.pageItems.map(({ plan, spot }) => (
                    <li key={plan.id}>
                      <button
                        onClick={() => setDetailSpotId(spot.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                      >
                        <SeriesBadge
                          series={spot.series}
                          seriesStyles={seriesStyles}
                          isPrivate={spot.status === "private"}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{spot.name}</p>
                          <p className="text-xs text-gray-500">{spot.region}</p>
                        </div>
                        <span className="shrink-0 text-xs text-gray-400">
                          {new Date(plan.created_at).toLocaleDateString("ja-JP")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <PagedListFooter
                  page={plannedPager.page}
                  totalPages={plannedPager.totalPages}
                  onChange={plannedPager.setPage}
                />
              </div>
            )}

            {/* 訪問予定リスト(旅程)。見出し+追加ボタンは0件でも常に出す */}
            <div className="mb-6">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h1 className="text-lg font-bold">訪問予定リスト</h1>
                <button
                  type="button"
                  onClick={() => setShowListForm(true)}
                  className="shrink-0 rounded-lg border border-blue-600 bg-white px-2.5 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
                >
                  + 訪問予定リストを追加
                </button>
              </div>
              {planLists.length === 0 ? (
                <p className="text-sm text-gray-500">
                  訪問予定リストはまだありません。「+ 訪問予定リストを追加」で旅程を作れます。
                </p>
              ) : (
                <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
                  {planLists.map((list) => (
                    <li key={list.id}>
                      <button
                        onClick={() => setDetailListId(list.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                      >
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm"
                          aria-hidden
                        >
                          📋
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{list.title}</p>
                          <p className="text-xs text-gray-500">
                            {formatPlanDateRange(list.start_date, list.end_date)}
                            {" ・ "}
                            {list.spot_ids.length}スポット
                          </p>
                        </div>
                        <span className="shrink-0 text-gray-400">›</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="mb-6">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h1 className="text-lg font-bold">最近の訪問場所</h1>
                {recentVisits.length > 0 && (
                  <button
                    type="button"
                    onClick={handleExportVisits}
                    disabled={exporting}
                    title="この種別の自分の訪問記録(メモ・写真)をZIPでダウンロード"
                    className="shrink-0 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {exporting ? "エクスポート中…" : "📦 エクスポート"}
                  </button>
                )}
              </div>
              {exportError && (
                <p className="mb-2 text-xs text-red-600">{exportError}</p>
              )}
              {recentVisits.length === 0 ? (
                <p className="text-sm text-gray-500">
                  まだ訪問記録がありません。
                </p>
              ) : (
                <>
                  <PagedListHeader
                    page={recentVisitsPager.page}
                    totalPages={recentVisitsPager.totalPages}
                    total={recentVisitsPager.total}
                    onChange={recentVisitsPager.setPage}
                  />
                  <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
                    {recentVisitsPager.pageItems.map((visit) => {
                      const spot = spotById.get(visit.spot_id)!;
                      return (
                        <li key={visit.id}>
                          <button
                            onClick={() => setDetailSpotId(spot.id)}
                            className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                          >
                            <SeriesBadge
                          series={spot.series}
                          seriesStyles={seriesStyles}
                          isPrivate={spot.status === "private"}
                          size="sm"
                        />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium">{spot.name}</p>
                              <p className="text-xs text-gray-500">{spot.region}</p>
                            </div>
                            <span className="shrink-0 text-xs text-gray-400">
                              {formatVisitedOn(visit.visited_on)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <PagedListFooter
                    page={recentVisitsPager.page}
                    totalPages={recentVisitsPager.totalPages}
                    onChange={recentVisitsPager.setPage}
                  />
                </>
              )}
            </div>
            {myReviews.length > 0 && (
              <div className="mb-6">
                <h1 className="mb-4 text-lg font-bold">自分が書いた口コミ</h1>
                <PagedListHeader
                  page={myReviewsPager.page}
                  totalPages={myReviewsPager.totalPages}
                  total={myReviewsPager.total}
                  onChange={myReviewsPager.setPage}
                />
                <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
                  {myReviewsPager.pageItems.map((review) => (
                    <li key={review.id}>
                      <button
                        onClick={() => setDetailSpotId(review.spot_id)}
                        className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-gray-50"
                      >
                        <SeriesBadge
                          series={review.spot_series}
                          seriesStyles={seriesStyles}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{review.spot_name}</p>
                          <p className="text-xs text-gray-500">{review.spot_region}</p>
                          <p className="mt-1 line-clamp-2 text-sm text-gray-700">
                            {review.body}
                          </p>
                        </div>
                        <span className="shrink-0 text-xs text-gray-400">
                          {new Date(review.created_at).toLocaleDateString("ja-JP")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <PagedListFooter
                  page={myReviewsPager.page}
                  totalPages={myReviewsPager.totalPages}
                  onChange={myReviewsPager.setPage}
                />
              </div>
            )}
            {myPrivateSpots.length > 0 && (
              <div className="mb-6">
                <h1 className="mb-4 text-lg font-bold">自分の非公開スポット</h1>
                <PagedListHeader
                  page={privateSpotsPager.page}
                  totalPages={privateSpotsPager.totalPages}
                  total={privateSpotsPager.total}
                  onChange={privateSpotsPager.setPage}
                />
                <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
                  {privateSpotsPager.pageItems.map((spot) => (
                    <li key={spot.id}>
                      <button
                        onClick={() => setDetailSpotId(spot.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                      >
                        <SeriesBadge
                          series={spot.series}
                          seriesStyles={seriesStyles}
                          isPrivate={spot.status === "private"}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{spot.name}</p>
                          <p className="text-xs text-gray-500">{spot.region}</p>
                        </div>
                        <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                          非公開
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                <PagedListFooter
                  page={privateSpotsPager.page}
                  totalPages={privateSpotsPager.totalPages}
                  onChange={privateSpotsPager.setPage}
                />
              </div>
            )}
          </section>

          <section>
            <div className="mb-4 flex items-center justify-between">
              <h1 className="text-lg font-bold">
                {browseMode === "region"
                  ? `${regionLabel}から探す`
                  : "シリーズから探す"}
              </h1>
              <div className="flex overflow-hidden rounded-lg border border-gray-300 text-xs">
                <button
                  type="button"
                  onClick={() => setBrowseMode("series")}
                  className={`px-2.5 py-1 font-medium ${
                    browseMode === "series"
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-500"
                  }`}
                >
                  シリーズ
                </button>
                <button
                  type="button"
                  onClick={() => setBrowseMode("region")}
                  className={`px-2.5 py-1 font-medium ${
                    browseMode === "region"
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-500"
                  }`}
                >
                  {regionLabel}
                </button>
              </div>
            </div>

            {browseMode === "region" ? (
              <>
                <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
                  {regionRows.map((row) => (
                    <li key={row.region}>
                      <button
                        onClick={() => setSelectedRegion(row.region)}
                        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
                      >
                        <span className="font-medium">{row.region}</span>
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
                {regionRows.length === 0 && (
                  <p className="text-sm text-gray-500">
                    スポットが未登録です。地図から追加してください。
                  </p>
                )}
              </>
            ) : (
              <>
                <form
                  onSubmit={handleManagementSearchSubmit}
                  className="mb-2 flex flex-wrap items-center gap-2"
                >
                  <input
                    type="search"
                    value={managementSearchInput}
                    onChange={(e) => setManagementSearchInput(e.target.value)}
                    placeholder={`名前・${regionLabel}で検索`}
                    className="min-w-40 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
                  />
                  <button
                    type="submit"
                    className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white"
                  >
                    検索
                  </button>
                </form>
                {managementAvailableSeries.length > 1 && (
                  <div className="mb-2">
                    <SeriesFilter
                      series={managementAvailableSeries}
                      selected={managementSeries}
                      onChange={handleManagementSeriesChange}
                      seriesStyles={seriesStyles}
                    />
                  </div>
                )}
                {managementLoaded && managementTotal > 0 && (
                  <PagedListHeader
                    page={managementPage}
                    totalPages={managementTotalPages}
                    total={managementTotal}
                    loading={managementLoading}
                    onChange={handleManagementPageChange}
                  />
                )}
                {!managementLoaded ? (
                  <p className="text-sm text-gray-500">読み込み中…</p>
                ) : (
                  <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
                    {managementItems.map((spot) => (
                      <li key={spot.id}>
                        <button
                          onClick={() => setDetailSpotId(spot.id)}
                          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                        >
                          <SeriesBadge
                          series={spot.series}
                          seriesStyles={seriesStyles}
                          isPrivate={spot.status === "private"}
                          size="sm"
                        />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium">{spot.name}</p>
                            <p className="text-xs text-gray-500">
                              {spot.region} ・{" "}
                              {formatCategoriesForDisplay(spot.categories, categories)}
                            </p>
                          </div>
                          {spot.status !== "published" && (
                            <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                              {STATUS_LABELS[spot.status]}
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {managementLoaded && managementItems.length === 0 && (
                  <p className="mt-2 text-sm text-gray-500">
                    条件に合うスポットがありません。
                  </p>
                )}
                {managementLoaded && managementTotal > 0 && (
                  <PagedListFooter
                    page={managementPage}
                    totalPages={managementTotalPages}
                    loading={managementLoading}
                    onChange={handleManagementPageChange}
                  />
                )}
              </>
            )}
          </section>
        </div>

        {detailSpotId && (
          <SpotDetailModal
            spotId={detailSpotId}
            spots={browseMode === "series" ? managementItems : spots}
            onClose={() => setDetailSpotId(null)}
            onVisitChange={loadVisits}
            onSpotChange={refreshAfterSpotChange}
            onSpotDeleted={refreshAfterSpotDelete}
            onVisitPlanChange={loadVisitPlans}
            onPlanListChange={loadPlanLists}
            onReviewChange={loadMyReviews}
          />
        )}

        {(showListForm || editingList) && (
          <VisitPlanListFormModal
            typeKey={spotTypeKey}
            edit={editingList ?? undefined}
            onClose={() => {
              setShowListForm(false);
              setEditingList(null);
            }}
          />
        )}

        {detailListId && (
          <VisitPlanListDetailModal
            listId={detailListId}
            spotsById={spotById}
            seriesStyles={seriesStyles}
            onClose={() => setDetailListId(null)}
            onEdit={(list) => {
              setDetailListId(null);
              setEditingList(list);
            }}
            onDeleted={() => {
              setDetailListId(null);
              loadPlanLists();
            }}
            onOpenSpot={(id) => {
              setDetailListId(null);
              setDetailSpotId(id);
            }}
          />
        )}
      </main>

      <SpotDownloadDialogs cache={spotCache} />
      </>
    );
  }

  // スポット一覧(都道府県を選択した直後)
  return (
    <>
    <main className="mx-auto max-w-lg p-4">
      <div className="mb-3 flex items-center gap-2">
        <button
          onClick={() => setSelectedRegion(null)}
          className="rounded-lg border border-gray-300 bg-white px-2 py-1 text-sm text-gray-600"
        >
          ← {regionLabel}
        </button>
        <h1 className="text-lg font-bold">{selectedRegion}</h1>
      </div>

      <div className="mb-3 space-y-2">
        <FilterBar
          spots={spots.filter((s) => s.region === selectedRegion)}
          filters={filters}
          onChange={setFilters}
          seriesStyles={seriesStyles}
          categories={categories}
        />
        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="series">シリーズ順</option>
          <option value="name">名前順</option>
          <option value="visited">訪問日順</option>
        </select>
      </div>

      {filteredSpots.length > 0 && (
        <PagedListHeader
          page={filteredSpotsPager.page}
          totalPages={filteredSpotsPager.totalPages}
          total={filteredSpotsPager.total}
          onChange={filteredSpotsPager.setPage}
        />
      )}
      <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
        {filteredSpotsPager.pageItems.map((spot) => (
          <li key={spot.id}>
            <button
              onClick={() => setDetailSpotId(spot.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
            >
              <SeriesBadge
                series={spot.series}
                seriesStyles={seriesStyles}
                isPrivate={spot.status === "private"}
                size="sm"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{spot.name}</p>
                <p className="text-xs text-gray-500">
                  {formatCategoriesForDisplay(spot.categories, categories)}
                </p>
              </div>
              {spot.status === "private" && (
                <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                  非公開
                </span>
              )}
              {visitedIds.has(spot.id) && (
                <span className="shrink-0 text-green-600">✓</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {filteredSpots.length === 0 ? (
        <p className="mt-4 text-sm text-gray-500">
          条件に合うスポットがありません。
        </p>
      ) : (
        <PagedListFooter
          page={filteredSpotsPager.page}
          totalPages={filteredSpotsPager.totalPages}
          onChange={filteredSpotsPager.setPage}
        />
      )}

      {detailSpotId && (
        <SpotDetailModal
          spotId={detailSpotId}
          spots={spots}
          onClose={() => setDetailSpotId(null)}
          onVisitChange={loadVisits}
          onSpotChange={refreshAfterSpotChange}
          onSpotDeleted={refreshAfterSpotDelete}
          onVisitPlanChange={loadVisitPlans}
          onPlanListChange={loadPlanLists}
          onReviewChange={loadMyReviews}
        />
      )}
    </main>
    <SpotDownloadDialogs cache={spotCache} />
    </>
  );
}
