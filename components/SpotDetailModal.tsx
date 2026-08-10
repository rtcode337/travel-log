"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useCurrentSpotTypeKey } from "@/lib/useSpotTypeKey";
import { useRouteOrigin } from "@/lib/useRouteOrigin";
import {
  countedVisits,
  formatVisitedOn,
  getSpotTypeSetting,
  REVIEWS_PAGE_SIZE,
  SPOT_ADMIN_ROLES,
  visitPhotoSrc,
  type PublicReview,
  type Role,
  type Spot,
  type SpotType,
  type Visit,
  type VisitPlanList,
} from "@/lib/types";
import { formatPlanDateRange } from "@/lib/planListDraft";
import SeriesBadge from "@/components/SeriesBadge";
import MiniMap from "@/components/MiniMap";
import { resolveSeriesStyles } from "@/lib/seriesStyle";
import {
  resolveWikipediaLang,
  resolveWikipediaTitleSource,
} from "@/lib/region";
import { formatCategoriesForDisplay, resolveCategories } from "@/lib/category";
import VisitFormModal from "@/components/VisitFormModal";
import AddSpotModal from "@/components/AddSpotModal";
import SpotInfoModal from "@/components/SpotInfoModal";
import SpotRepositionModal from "@/components/SpotRepositionModal";
import AddToPlanListModal from "@/components/AddToPlanListModal";
import { DirectionsIcon } from "@/components/GoogleMapsRouteLink";
import VisitPlanListDetailModal from "@/components/VisitPlanListDetailModal";
import VisitPlanListFormModal from "@/components/VisitPlanListFormModal";

/**
 * Wikipediaの公式ロゴマーク(Simple Icons、CC0)。
 * 地図の「訪問予定リストに追加しますか?」の確認でも同じマークを出すためexportする
 */
export function WikipediaIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M12.09 13.119c-.936 1.932-2.217 4.548-2.853 5.728-.616 1.074-1.127.931-1.532.029-1.406-3.321-4.293-9.144-5.651-12.409-.251-.601-.441-.987-.619-1.139-.181-.15-.554-.24-1.122-.271C.103 5.033 0 4.982 0 4.898v-.455l.052-.045c.924-.005 5.401 0 5.401 0l.051.045v.434c0 .119-.075.176-.225.176l-.564.031c-.485.029-.727.164-.727.436 0 .135.053.33.166.601 1.082 2.646 4.818 10.521 4.818 10.521l.136.046 2.411-4.81-.482-1.067-1.658-3.264s-.318-.654-.428-.872c-.728-1.443-.712-1.518-1.447-1.617-.207-.023-.313-.05-.313-.149v-.468l.06-.045h4.292l.113.037v.451c0 .105-.076.15-.227.15l-.308.047c-.792.061-.661.381-.136 1.422l1.582 3.252 1.758-3.504c.293-.64.233-.801.111-.947-.07-.084-.305-.22-.812-.24l-.201-.021c-.052 0-.098-.015-.145-.051-.045-.031-.067-.076-.067-.129v-.427l.061-.045c1.247-.008 4.043 0 4.043 0l.059.045v.436c0 .121-.059.178-.193.178-.646.03-.782.095-1.023.439-.12.186-.375.589-.646 1.039l-2.301 4.273-.065.135 2.792 5.712.17.048 4.396-10.438c.154-.422.129-.722-.064-.895-.197-.172-.346-.273-.857-.295l-.42-.016c-.061 0-.105-.014-.152-.045-.043-.029-.072-.075-.072-.119v-.436l.059-.045h4.961l.041.045v.437c0 .119-.074.18-.209.18-.648.03-1.127.18-1.443.421-.314.255-.557.616-.736 1.067 0 0-4.043 9.258-5.426 12.339-.525 1.007-1.053.917-1.503-.031-.571-1.171-1.773-3.786-2.646-5.71l.053-.036z" />
    </svg>
  );
}

/** Google マップの公式ロゴマーク(Simple Icons、CC0) */
function GoogleMapsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M19.527 4.799c1.212 2.608.937 5.678-.405 8.173-1.101 2.047-2.744 3.74-4.098 5.614-.619.858-1.244 1.75-1.669 2.727-.141.325-.263.658-.383.992-.121.333-.224.673-.34 1.008-.109.314-.236.684-.627.687h-.007c-.466-.001-.579-.53-.695-.887-.284-.874-.581-1.713-1.019-2.525-.51-.944-1.145-1.817-1.79-2.671L19.527 4.799zM8.545 7.705l-3.959 4.707c.724 1.54 1.821 2.863 2.871 4.18.247.31.494.622.737.936l4.984-5.925-.029.01c-1.741.601-3.691-.291-4.392-1.987a3.377 3.377 0 0 1-.209-.716c-.063-.437-.077-.761-.004-1.198l.001-.007zM5.492 3.149l-.003.004c-1.947 2.466-2.281 5.88-1.117 8.77l4.785-5.689-.058-.05-3.607-3.035zM14.661.436l-3.838 4.563a.295.295 0 0 1 .027-.01c1.6-.551 3.403.15 4.22 1.626.176.319.323.683.377 1.045.068.446.085.773.012 1.22l-.003.016 3.836-4.561A8.382 8.382 0 0 0 14.67.439l-.009-.003zM9.466 5.868L14.162.285l-.047-.012A8.31 8.31 0 0 0 11.986 0a8.439 8.439 0 0 0-6.169 2.766l-.016.018 3.665 3.084z" />
    </svg>
  );
}

/** 星アイコン(Google Material Symbols「star」/「star_border」、Apache License 2.0) */
function StarIcon({ filled, className }: { filled: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      {filled ? (
        <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" />
      ) : (
        <path d="M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z" />
      )}
    </svg>
  );
}

function formatReviewDatetime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SpotDetailModal({
  spotId,
  spots,
  readOnly = false,
  allowVisitRecording = false,
  allowPlanList = false,
  onClose,
  onVisitChange,
  onSpotChange,
  onSpotDeleted,
  onVisitPlanChange,
  onPlanListChange,
  onReviewChange,
  onHideChange,
  onOpenSpot,
}: {
  spotId: string;
  /** 編集モーダルのシリーズ・カテゴリ入力サジェスト用(省略時はサジェストなし) */
  spots?: Spot[];
  /**
   * 読み取り専用表示(地図の「別の種別を重ねて表示」から開いた場合)。
   * 更新系(編集・削除・承認/却下・訪問記録・訪問予定・訪問記録の削除)を
   * すべて出さず、「地図で開く」の代わりに元のスポット種別の地図へのリンクを出す
   * (このスポットは表示中の種別の地図では表示できないため)
   */
  readOnly?: boolean;
  /** readOnly(重ね表示)でも「訪問を記録」だけは許可する。地図で経路表示中に、
   *  重ね表示した別種別スポットへ種別を切り替えずに訪問記録し、リストから外すために使う。
   *  スポットの編集・削除や訪問予定/予定リスト追加は readOnly のまま隠す */
  allowVisitRecording?: boolean;
  /**
   * readOnly(重ね表示)でも「訪問予定」セクション(訪問予定リストへの追加と、
   * このスポットを含むリストの一覧)を出す。対象は常に**今開いている地図の種別**
   * (URLの`[type]`)のリストで、重ねられた側の種別のリストは扱わない
   * ——リストの経由スポットは種別非依存のため、別種別のスポットも現在の種別の
   * 旅程に混ぜて入れられる
   */
  allowPlanList?: boolean;
  onClose: () => void;
  /** 訪問記録の追加・削除があったときに呼ばれる(呼び出し元の一覧・バッジ更新用) */
  onVisitChange?: () => void;
  /** 新しい訪問記録が追加されたときだけ、そのスポットIDとともに呼ばれる
   * (地図で経路表示中の訪問予定リストから、訪問済みスポットを自動で外すのに使う。
   *  訪問記録の編集・削除では呼ばれない) */
  /** スポット自体の編集・承認/却下で内容が変わったときに、変更後の内容とともに呼ばれる
   * (呼び出し元の一覧の再取得・公開スポットキャッシュの更新用) */
  onSpotChange?: (spot: Spot) => void;
  /** スポットが削除されたときに、削除されたIDとともに呼ばれる(呼び出し元の一覧の再取得用) */
  onSpotDeleted?: (spotId: string) => void;
  /** 訪問予定への追加・解除があったときに呼ばれる(呼び出し元の一覧の再取得用) */
  onVisitPlanChange?: () => void;
  /** 既存の訪問予定リストへこのスポットを追加したときに呼ばれる(呼び出し元の
   * リスト一覧の再取得用。地図なら経路表示中のリストの線にも反映される) */
  onPlanListChange?: () => void;
  /** 口コミの投稿があったときに呼ばれる(呼び出し元の「自分が書いた口コミ」一覧の再取得用) */
  onReviewChange?: () => void;
  /** このスポットの非表示/解除を切り替えたときに呼ばれる(呼び出し元の地図・一覧への反映用) */
  onHideChange?: () => void;
  /** 「訪問予定」セクションのリスト詳細から別のスポットが選ばれたときに呼ばれる
   * (呼び出し元が表示対象のスポットIDを差し替える。省略時はリスト詳細を閉じるだけ) */
  onOpenSpot?: (spotId: string) => void;
}) {
  const typeKey = useCurrentSpotTypeKey();
  const [spot, setSpot] = useState<Spot | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [spotTypes, setSpotTypes] = useState<SpotType[]>([]);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [reviewsTotal, setReviewsTotal] = useState(0);
  const [reviewsPage, setReviewsPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  // 非公開スポットの位置修正(ドラッグ)モーダルの表示
  const [showReposition, setShowReposition] = useState(false);
  // 編集対象の訪問記録(訪問履歴の「編集」から開く。VisitFormModalの編集モード)
  const [editingVisit, setEditingVisit] = useState<Visit | null>(null);
  const [showEditForm, setShowEditForm] = useState(false);
  // Wikipediaから取得したスポット情報(写真+概要)のモーダル表示
  const [showInfo, setShowInfo] = useState(false);
  // 「訪問予定リストへ追加」モーダルの表示
  const [showAddToList, setShowAddToList] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [planned, setPlanned] = useState(false);
  const [planUpdating, setPlanUpdating] = useState(false);
  // この種別の訪問予定リスト(「訪問予定」セクションでこのスポットを含むものを表示する)
  const [planLists, setPlanLists] = useState<VisitPlanList[]>([]);
  // 「訪問予定」セクションから開くリスト詳細と、その「編集」から開く編集フォーム
  const [detailListId, setDetailListId] = useState<string | null>(null);
  const [editingPlanList, setEditingPlanList] = useState<VisitPlanList | null>(null);
  // このスポットを自分の地図・一覧から非表示にしているか(公開スポットのみ)
  const [hidden, setHidden] = useState(false);
  const [hideUpdating, setHideUpdating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [moderating, setModerating] = useState(false);
  // 訪問履歴のサムネイルをタップしたときに拡大表示する写真のURL
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  // 「Google マップで経路を表示」のorigin(出発地)に使う現在地
  const routeOrigin = useRouteOrigin();

  // 拡大表示中はEscキーでも閉じられるようにする
  useEffect(() => {
    if (!photoPreview) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPhotoPreview(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [photoPreview]);

  const load = useCallback(async () => {
    const [
      { data: spotData },
      { data: visitsData },
      { data: typesData },
      { data: plansData },
      { data: hidesData },
    ] = await Promise.all([
      api.spots.get(spotId),
      api.visits.list(spotId),
      api.spotTypes.list(),
      api.visitPlans.list(spotId),
      api.spotHides.list(spotId),
    ]);
    setSpot(spotData ?? null);
    setVisits(visitsData ?? []);
    setSpotTypes(typesData ?? []);
    setPlanned((plansData?.length ?? 0) > 0);
    setHidden((hidesData?.length ?? 0) > 0);
    setLoading(false);
  }, [spotId]);

  useEffect(() => {
    load();
    setReviewsPage(1);
  }, [load]);

  // 訪問予定セクション(リストへの追加・所属リストの一覧)を出すか。
  // readOnly(重ね表示)では既定で出さないが、allowPlanListが立っていれば出す
  const planListEnabled = !readOnly || allowPlanList;

  // 訪問予定リストの読み込み(セクションを出さないときは読まない)
  const loadPlanLists = useCallback(async () => {
    if (!typeKey || !planListEnabled) return;
    const { data } = await api.visitPlanLists.list(typeKey);
    setPlanLists(data ?? []);
  }, [typeKey, planListEnabled]);

  useEffect(() => {
    loadPlanLists();
  }, [loadPlanLists]);

  useEffect(() => {
    api.auth.me().then(({ data }) => {
      setMyId(data?.id ?? null);
      setMyRole(data?.role ?? null);
    });
  }, []);

  const toggleVisitPlan = async () => {
    setPlanUpdating(true);
    const { error } = planned
      ? await api.visitPlans.delete(spotId)
      : await api.visitPlans.create(spotId);
    setPlanUpdating(false);
    if (error) return;
    setPlanned((prev) => !prev);
    onVisitPlanChange?.();
  };

  // このスポットを経由スポットに含む訪問予定リスト(「訪問予定」セクションに表示)
  const containingPlanLists = useMemo(
    () => planLists.filter((list) => list.spot_ids.includes(spotId)),
    [planLists, spotId]
  );

  // リスト詳細モーダルの経由スポット解決用。spots(サジェスト用の一覧)+表示中の
  // スポットから引き、無いIDはモーダル側がAPIで補完する
  const spotsById = useMemo(() => {
    const map = new Map((spots ?? []).map((s) => [s.id, s] as const));
    if (spot) map.set(spot.id, spot);
    return map;
  }, [spots, spot]);

  const isSpotAdmin = !!myRole && SPOT_ADMIN_ROLES.includes(myRole);

  // 編集・削除できるのは、公開スポットはspot_admin/admin、それ以外(非公開・承認待ち・
  // 却下)は追加した本人のみ(APIのcanEditOrDeleteと同じルール)。読み取り専用時は常に不可
  const canManage =
    !readOnly &&
    !!spot &&
    (spot.status === "published" ? isSpotAdmin : spot.created_by === myId);

  // 承認待ち→公開/却下の変更はspot_admin/adminのみ(投稿者本人かどうかは問わない)
  const canModerate = !readOnly && !!spot && spot.status === "pending" && isSpotAdmin;

  const currentSpotType = useMemo(
    () => spotTypes.find((t) => t.id === spot?.spot_type_id) ?? null,
    [spotTypes, spot]
  );
  // 今開いている地図・一覧の種別(URLの[type])。スポット自身の種別
  // (currentSpotType)とは、重ね表示から開いたときだけ食い違う
  const viewingSpotType = useMemo(
    () => spotTypes.find((t) => t.key === typeKey) ?? null,
    [spotTypes, typeKey]
  );
  const seriesStyles = useMemo(
    () => resolveSeriesStyles(currentSpotType),
    [currentSpotType]
  );
  // 訪問予定リストは今開いている種別のもので、経由スポットもその種別が主体のため、
  // リスト詳細のバッジはそちらのシリーズ設定で描く(重ね表示から開いたときだけ
  // スポット自身の種別と食い違う)
  const planListSeriesStyles = useMemo(
    () => resolveSeriesStyles(viewingSpotType ?? currentSpotType),
    [viewingSpotType, currentSpotType]
  );
  // 複数カテゴリを種別の設定順に並べて表示するために使う
  const categories = useMemo(
    () => resolveCategories(currentSpotType),
    [currentSpotType]
  );

  // 非公開スポットは口コミの表示・投稿ともに不可
  const reviewsEnabled = useMemo(
    () =>
      spot?.status !== "private" &&
      getSpotTypeSetting(currentSpotType, "reviews_enabled"),
    [currentSpotType, spot]
  );

  // 大半のスポットにWikipedia記事が存在しない種別では、リンクが機能しないため出さない
  const wikipediaEnabled = useMemo(
    () => getSpotTypeSetting(currentSpotType, "wikipedia_enabled"),
    [currentSpotType]
  );
  // 参照するWikipediaの言語版(種別ごとのwikipedia_lang設定、既定'ja')
  const wikipediaLang = useMemo(
    () => resolveWikipediaLang(currentSpotType),
    [currentSpotType]
  );
  // 記事を「何の名前」で探すか(種別ごとのwikipedia_title_source設定、既定'name')。
  // 'series'の種別ではシリーズ名(アニメ聖地なら作品名)の記事を優先して開く
  const wikipediaTitleSource = useMemo(
    () => resolveWikipediaTitleSource(currentSpotType),
    [currentSpotType]
  );

  const loadReviews = useCallback(
    async (page: number) => {
      const { data } = await api.reviews.list(spotId, page);
      setReviews(data?.items ?? []);
      setReviewsTotal(data?.total ?? 0);
    },
    [spotId]
  );

  useEffect(() => {
    if (spot && reviewsEnabled) loadReviews(reviewsPage);
  }, [loadReviews, spot, reviewsEnabled, reviewsPage]);

  const reviewsTotalPages = Math.max(
    1,
    Math.ceil(reviewsTotal / REVIEWS_PAGE_SIZE)
  );

  const deleteVisit = async (id: string) => {
    if (!confirm("この訪問記録を削除しますか?")) return;
    await api.visits.delete(id);
    load();
    onVisitChange?.();
  };

  // 非表示のトグル(公開スポットのみ)。地図・一覧への反映は呼び出し元が行う
  const toggleHidden = async () => {
    setHideUpdating(true);
    const { error } = hidden
      ? await api.spotHides.delete(spotId)
      : await api.spotHides.create(spotId);
    setHideUpdating(false);
    if (error) return;
    setHidden((prev) => !prev);
    onHideChange?.();
  };

  const handleDeleteSpot = async () => {
    if (!spot) return;
    if (!confirm(`「${spot.name}」を削除しますか?(訪問記録も消えます)`)) return;
    setActionError(null);
    const { error } = await api.spots.delete(spot.id);
    if (error) {
      setActionError("削除に失敗しました: " + error.message);
      return;
    }
    onSpotDeleted?.(spot.id);
    onClose();
  };

  const handleModerate = async (status: "published" | "rejected") => {
    if (!spot) return;
    setModerating(true);
    setActionError(null);
    const { data, error } = await api.spots.setStatus(spot.id, status);
    setModerating(false);
    if (error || !data) {
      setActionError(
        (status === "published" ? "承認" : "却下") + "に失敗しました: " + (error?.message ?? "")
      );
      return;
    }
    await load();
    onSpotChange?.(data);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <p className="p-4 text-sm text-gray-500">読み込み中…</p>
        ) : !spot ? (
          <p className="p-4 text-sm text-gray-500">スポットが見つかりません。</p>
        ) : (
          <>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <SeriesBadge
                  series={spot.series}
                  seriesStyles={seriesStyles}
                  isPrivate={spot.status === "private"}
                />
                <div className="min-w-0">
                  <h2 className="text-lg font-bold leading-tight">
                    {spot.name}
                    {spot.status === "private" && (
                      <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-xs font-normal text-gray-600">
                        非公開
                      </span>
                    )}
                    {spot.status === "pending" && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700">
                        承認待ち
                      </span>
                    )}
                    {spot.status === "rejected" && (
                      <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-normal text-red-600">
                        却下
                      </span>
                    )}
                    {canModerate && (
                      <>
                        <button
                          type="button"
                          disabled={moderating}
                          onClick={() => handleModerate("published")}
                          className="ml-2 text-xs font-normal text-green-600 underline disabled:opacity-50"
                        >
                          承認
                        </button>
                        <button
                          type="button"
                          disabled={moderating}
                          onClick={() => handleModerate("rejected")}
                          className="ml-2 text-xs font-normal text-red-500 underline disabled:opacity-50"
                        >
                          却下
                        </button>
                      </>
                    )}
                  </h2>
                  {actionError && (
                    <p className="mt-1 text-xs text-red-600">{actionError}</p>
                  )}
                  <p className="text-xs text-gray-500">
                    {spot.region} ・{" "}
                    {formatCategoriesForDisplay(spot.categories, categories)}
                    {reviewsEnabled && reviewsTotal > 0 && (
                      <span className="ml-2 text-gray-400">
                        口コミ{reviewsTotal}件
                      </span>
                    )}
                  </p>
                </div>
              </div>
              {/* ×ボタンと、その左に訪問予定のブックマーク風★トグル(塗り=予定あり)。
                  一時期×を外して外側タップだけにしていたが、このモーダルは画面の
                  ほぼ全体を占めるため外側の余白が狭すぎて閉じにくく、復活させた */}
              <div className="flex shrink-0 items-center gap-1">
                {!readOnly && (
                  <button
                    onClick={toggleVisitPlan}
                    disabled={planUpdating}
                    aria-label={planned ? "訪問予定をはずす" : "訪問予定にする"}
                    title={planned ? "訪問予定をはずす" : "訪問予定にする"}
                    aria-pressed={planned}
                    className={`rounded p-1 disabled:opacity-50 ${
                      planned
                        ? "text-amber-400 hover:bg-amber-50"
                        : "text-gray-400 hover:bg-gray-50"
                    }`}
                  >
                    <StarIcon filled={planned} className="size-6" />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="rounded-full px-2 text-xl leading-none text-gray-400"
                  aria-label="閉じる"
                >
                  ×
                </button>
              </div>
            </div>

            {spot.description && (
              <p className="mb-3 text-sm text-gray-700">{spot.description}</p>
            )}

            <div className="relative">
              <MiniMap
                lat={spot.lat}
                lng={spot.lng}
                series={spot.series}
                seriesStyles={seriesStyles}
              />
              {canManage && (
                <div className="absolute right-2 top-2 z-10 flex gap-2 rounded-lg bg-white/90 px-2 py-1 shadow">
                  <button
                    type="button"
                    onClick={() => setShowEditForm(true)}
                    className="text-xs font-normal text-blue-600 underline"
                  >
                    編集
                  </button>
                  {/* 非公開スポットはドラッグで位置を修正できる(座標だけを直せる) */}
                  {spot.status === "private" && (
                    <button
                      type="button"
                      onClick={() => setShowReposition(true)}
                      className="text-xs font-normal text-blue-600 underline"
                    >
                      位置を修正
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleDeleteSpot}
                    className="text-xs font-normal text-red-500 underline"
                  >
                    削除
                  </button>
                </div>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {readOnly ? (
                // 重ね表示から開いた別種別のスポットは、表示中の種別の地図では
                // 表示できないため、元のスポット種別の地図へのリンクを出す。
                // fromに今表示中の種別を渡すと、遷移先の地図に「元の地図に戻る」
                // リンクが出る(戻り先の表示位置はMapViewのlastViewsが復元する)
                currentSpotType && (
                  <Link
                    href={`/${currentSpotType.key}/map?spot=${spot.id}${
                      typeKey ? `&from=${encodeURIComponent(typeKey)}` : ""
                    }`}
                    className="inline-block text-sm text-blue-600 underline"
                  >
                    「{currentSpotType.label}」の地図で開く
                  </Link>
                )
              ) : (
                <Link
                  href={`${typeKey ? `/${typeKey}` : ""}/map?spot=${spot.id}`}
                  className="inline-block text-sm text-blue-600 underline"
                >
                  地図で開く
                </Link>
              )}
              {wikipediaEnabled && (
                <button
                  type="button"
                  onClick={() => setShowInfo(true)}
                  aria-label="Wikipediaでスポット詳細を開く"
                  title="Wikipediaでスポット詳細を開く"
                  className="rounded p-1 text-blue-600 hover:bg-blue-50"
                >
                  <WikipediaIcon className="size-5" />
                </button>
              )}
              <div className="ml-auto flex items-center gap-1 text-sm text-gray-500">
                Google:
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    `${spot.name} ${spot.lat},${spot.lng}`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Google マップで開く"
                  title="Google マップで開く"
                  className="rounded p-1 text-blue-600 hover:bg-blue-50"
                >
                  <GoogleMapsIcon className="size-5" />
                </a>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                    `${spot.lat},${spot.lng}`
                  )}${
                    routeOrigin
                      ? `&origin=${encodeURIComponent(`${routeOrigin.lat},${routeOrigin.lng}`)}`
                      : ""
                  }`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Google マップで経路を表示"
                  title="Google マップで経路を表示"
                  className="rounded p-1 text-blue-600 hover:bg-blue-50"
                >
                  <DirectionsIcon className="size-5" />
                </a>
              </div>
            </div>

            {/* 訪問履歴 */}
            <div className="mt-4 border-t border-gray-100 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="font-bold">訪問履歴</h3>
                  {/* 未訪問記録は訪問済みに数えないため、✓の回数には含めない */}
                  {countedVisits(visits).length > 0 && (
                    <p className="text-sm font-normal text-green-600">
                      ✓ {countedVisits(visits).length}回
                    </p>
                  )}
                </div>
                {(!readOnly || allowVisitRecording) && (
                  <div className="flex flex-wrap justify-end gap-2">
                    {/* 未訪問記録(訪問済みにしない記録)も同じフォームから記録する
                        (フォーム内のチェックボックスで切り替え) */}
                    <button
                      onClick={() => setShowForm(true)}
                      className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white"
                    >
                      + 訪問を記録
                    </button>
                  </div>
                )}
              </div>
              {visits.length === 0 ? (
                <p className="text-sm text-gray-500">
                  まだ訪問記録がありません。
                </p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {visits.map((visit) => (
                    <li key={visit.id} className="py-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium">
                            {/* 日時なしの未訪問記録=下調べのメモ(「時期不明」とは意味が違う) */}
                            {visit.unvisited && !visit.visited_on
                              ? "下調べ"
                              : formatVisitedOn(visit.visited_on)}
                            {visit.unvisited && (
                              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-700">
                                未訪問
                              </span>
                            )}
                          </p>
                          {visit.memo && (
                            <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-600">
                              {visit.memo}
                            </p>
                          )}
                          {visit.photos.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {visit.photos.map((photo, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  onClick={() =>
                                    setPhotoPreview(visitPhotoSrc(photo))
                                  }
                                  className="cursor-zoom-in"
                                  aria-label="写真を拡大表示"
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={visitPhotoSrc(photo)}
                                    alt=""
                                    className="h-14 w-14 rounded-lg object-cover"
                                  />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        {!readOnly && (
                          <div className="flex shrink-0 gap-2">
                            <button
                              onClick={() => setEditingVisit(visit)}
                              className="text-xs text-gray-400 hover:text-blue-600"
                            >
                              編集
                            </button>
                            <button
                              onClick={() => deleteVisit(visit.id)}
                              className="text-xs text-gray-400 hover:text-red-500"
                            >
                              削除
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* 訪問予定(訪問予定リスト)。リストへの追加と、このスポットを含む
                リストの表示。★(訪問予定の単独ブックマーク)はヘッダー右上 */}
            {planListEnabled && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-bold">訪問予定</h3>
                  <button
                    onClick={() => setShowAddToList(true)}
                    className="rounded-lg border border-blue-600 px-3 py-1.5 text-sm font-medium text-blue-600"
                  >
                    リストに追加
                  </button>
                </div>
                {/* 重ね表示から開いた別種別のスポットでも、対象は今開いている地図の
                    種別のリスト(リストの経由スポットは種別非依存のため混ぜられる) */}
                {readOnly && viewingSpotType && (
                  <p className="mb-2 text-xs text-gray-400">
                    今開いている「{viewingSpotType.label}」の地図の訪問予定リストが対象です。
                  </p>
                )}
                {containingPlanLists.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    このスポットを含む訪問予定リストはありません。
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {containingPlanLists.map((list) => (
                      <li key={list.id} className="py-2">
                        <button
                          type="button"
                          onClick={() => setDetailListId(list.id)}
                          className="text-sm font-medium text-blue-600 underline"
                        >
                          {list.title}
                        </button>
                        <p className="text-xs text-gray-500">
                          {formatPlanDateRange(list.start_date, list.end_date)}・
                          {list.spot_ids.length}件
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* 口コミ(公開・掲示板形式) */}
            {reviewsEnabled && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <h3 className="mb-3 font-bold">
                  口コミ
                  {reviewsTotal > 0 && (
                    <span className="ml-1 font-normal text-gray-400">
                      ({reviewsTotal}件)
                    </span>
                  )}
                </h3>
                {reviews.length === 0 ? (
                  <p className="text-sm text-gray-500">
                    まだ口コミがありません。
                  </p>
                ) : (
                  <>
                    <ul className="divide-y divide-gray-100">
                      {reviews.map((review) => (
                        <li key={review.id} className="py-2.5">
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="text-sm font-medium">
                              {review.user_name}
                            </span>
                            <span className="shrink-0 text-xs text-gray-400">
                              {formatReviewDatetime(review.created_at)}
                            </span>
                          </div>
                          <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-700">
                            {review.body}
                          </p>
                        </li>
                      ))}
                    </ul>
                    {reviewsTotalPages > 1 && (
                      <div className="mt-3 flex items-center justify-center gap-3">
                        <button
                          type="button"
                          disabled={reviewsPage <= 1}
                          onClick={() => setReviewsPage((p) => p - 1)}
                          className="rounded-lg border border-gray-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          前へ
                        </button>
                        <span className="text-sm text-gray-500">
                          {reviewsPage} / {reviewsTotalPages}
                        </span>
                        <button
                          type="button"
                          disabled={reviewsPage >= reviewsTotalPages}
                          onClick={() => setReviewsPage((p) => p + 1)}
                          className="rounded-lg border border-gray-300 px-3 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          次へ
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
            {/* 非表示スポット(公開スポットを自分の地図・一覧から隠す)。スポット自体には
                影響しないユーザーごとの設定のため、公開スポットでのみ出す */}
            {!readOnly && spot.status === "published" && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-gray-400">
                    {hidden
                      ? "このスポットは非表示にしています(自分の地図・一覧に表示されません)。"
                      : "興味のないスポットは、自分の地図・一覧から非表示にできます(他のユーザーには影響しません)。"}
                  </p>
                  <button
                    type="button"
                    onClick={toggleHidden}
                    disabled={hideUpdating}
                    className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                      hidden
                        ? "border-blue-600 text-blue-600"
                        : "border-gray-300 text-gray-500"
                    }`}
                  >
                    {hidden ? "非表示を解除" : "非表示にする"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showForm && spot && (
        <VisitFormModal
          spotId={spot.id}
          spotName={spot.name}
          reviewsEnabled={!readOnly && reviewsEnabled}
          onClose={() => setShowForm(false)}
          onSaved={(saved) => {
            setShowForm(false);
            load();
            setReviewsPage(1);
            loadReviews(1);
            onVisitChange?.();
            // 訪問記録時、サーバー側で訪問予定からも自動的に外れる
            onVisitPlanChange?.();
            onReviewChange?.();
            // 訪問記録を付けると、サーバー側でその場所を含む訪問予定リストの
            // 経由スポットに訪問済みの印が付き、地図の経路から外れる。印の付いた
            // 状態を出すためにリストを取り直す(自分の「訪問予定」欄と、リストを
            // 持っている呼び出し元の両方)。日時なしの未訪問記録(下調べ)は
            // サーバー側でも印が付かない(まだ行っていない)ため取り直さない
            if (saved && !(saved.unvisited && !saved.visited_on)) {
              loadPlanLists();
              onPlanListChange?.();
            }
          }}
        />
      )}

      {editingVisit && spot && (
        <VisitFormModal
          spotId={spot.id}
          spotName={spot.name}
          reviewsEnabled={!readOnly && reviewsEnabled}
          visit={editingVisit}
          onClose={() => setEditingVisit(null)}
          onSaved={() => {
            setEditingVisit(null);
            load();
            // 訪問日時の変更は呼び出し元の訪問日絞り込み・訪問順の矢印にも影響する
            onVisitChange?.();
          }}
        />
      )}

      {showInfo && spot && (
        <SpotInfoModal
          spotName={spot.name}
          region={spot.region}
          lang={wikipediaLang}
          primaryTitle={
            wikipediaTitleSource === "series" ? spot.series : null
          }
          onClose={() => setShowInfo(false)}
        />
      )}

      {/* 写真の拡大表示(ライトボックス)。背景・画像どこをタップしても閉じる。
          親のオーバーレイ(スポット詳細を閉じる)まで伝播させない */}
      {photoPreview && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 p-4"
          onClick={(e) => {
            e.stopPropagation();
            setPhotoPreview(null);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={photoPreview}
            alt=""
            className="max-h-full max-w-full rounded-lg object-contain"
          />
          <button
            type="button"
            className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-xl text-white"
            aria-label="拡大表示を閉じる"
          >
            ×
          </button>
        </div>
      )}

      {showEditForm && spot && (
        <AddSpotModal
          spot={spot}
          spots={spots ?? []}
          role={null}
          onClose={() => setShowEditForm(false)}
          onSaved={(updated) => {
            setShowEditForm(false);
            load();
            onSpotChange?.(updated);
          }}
          onDeleted={() => {
            setShowEditForm(false);
            onSpotDeleted?.(spot.id);
            onClose();
          }}
        />
      )}

      {showReposition && spot && (
        <SpotRepositionModal
          spot={spot}
          onClose={() => setShowReposition(false)}
          onSaved={(updated) => {
            setShowReposition(false);
            setSpot(updated);
            onSpotChange?.(updated);
          }}
        />
      )}
      {showAddToList && typeKey && (
        <AddToPlanListModal
          spotId={spotId}
          spotName={spot?.name}
          typeKey={typeKey}
          onClose={() => setShowAddToList(false)}
          onAdded={() => {
            loadPlanLists();
            onPlanListChange?.();
          }}
        />
      )}
      {/* 「訪問予定」セクションのタイトルから開くリスト詳細(z-50同士だが後段に
          描画されるため上に重なる) */}
      {detailListId && (
        <VisitPlanListDetailModal
          listId={detailListId}
          spotsById={spotsById}
          seriesStyles={planListSeriesStyles}
          onClose={() => setDetailListId(null)}
          onEdit={(list) => {
            setDetailListId(null);
            setEditingPlanList(list);
          }}
          onDeleted={() => {
            setDetailListId(null);
            loadPlanLists();
            onPlanListChange?.();
          }}
          onOpenSpot={(id) => {
            setDetailListId(null);
            // 表示中のスポット自身なら閉じるだけでよい。別のスポットは呼び出し元に
            // 表示対象の差し替えを頼む(onOpenSpot未指定の呼び出し元では何もしない)
            if (id !== spotId) onOpenSpot?.(id);
          }}
          // 訪問済みの付け外しは経路(地図の紫の矢印)の見え方を変えるため、
          // リストを持っている呼び出し元にも取り直させる
          onChanged={() => {
            loadPlanLists();
            onPlanListChange?.();
          }}
        />
      )}
      {editingPlanList && typeKey && (
        <VisitPlanListFormModal
          typeKey={typeKey}
          edit={editingPlanList}
          onClose={() => setEditingPlanList(null)}
          onSaved={() => {
            loadPlanLists();
            onPlanListChange?.();
          }}
        />
      )}
    </div>
  );
}
