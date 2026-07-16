"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api-client";
import { useCurrentSpotTypeKey } from "@/lib/useSpotTypeKey";
import {
  formatVisitedOn,
  REVIEWS_PAGE_SIZE,
  SPOT_ADMIN_ROLES,
  visitPhotoSrc,
  type PublicReview,
  type Role,
  type Spot,
  type SpotType,
  type Visit,
} from "@/lib/types";
import RankBadge from "@/components/RankBadge";
import MiniMap from "@/components/MiniMap";
import VisitFormModal from "@/components/VisitFormModal";
import AddSpotModal from "@/components/AddSpotModal";
import SpotInfoModal from "@/components/SpotInfoModal";

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
  onClose,
  onVisitChange,
  onSpotChange,
  onSpotDeleted,
  onVisitPlanChange,
}: {
  spotId: string;
  /** 編集モーダルのランク・カテゴリ入力サジェスト用(省略時はサジェストなし) */
  spots?: Spot[];
  onClose: () => void;
  /** 訪問記録の追加・削除があったときに呼ばれる(呼び出し元の一覧・バッジ更新用) */
  onVisitChange?: () => void;
  /** スポット自体の編集・承認/却下で内容が変わったときに、変更後の内容とともに呼ばれる
   * (呼び出し元の一覧の再取得・公開スポットキャッシュの更新用) */
  onSpotChange?: (spot: Spot) => void;
  /** スポットが削除されたときに、削除されたIDとともに呼ばれる(呼び出し元の一覧の再取得用) */
  onSpotDeleted?: (spotId: string) => void;
  /** 訪問予定への追加・解除があったときに呼ばれる(呼び出し元の一覧の再取得用) */
  onVisitPlanChange?: () => void;
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
  const [showEditForm, setShowEditForm] = useState(false);
  // Wikipediaから取得したスポット情報(写真+概要)のモーダル表示
  const [showInfo, setShowInfo] = useState(false);
  const [myId, setMyId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [planned, setPlanned] = useState(false);
  const [planUpdating, setPlanUpdating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [moderating, setModerating] = useState(false);
  // 訪問履歴のサムネイルをタップしたときに拡大表示する写真のURL
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

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
    ] = await Promise.all([
      api.spots.get(spotId),
      api.visits.list(spotId),
      api.spotTypes.list(),
      api.visitPlans.list(spotId),
    ]);
    setSpot(spotData ?? null);
    setVisits(visitsData ?? []);
    setSpotTypes(typesData ?? []);
    setPlanned((plansData?.length ?? 0) > 0);
    setLoading(false);
  }, [spotId]);

  useEffect(() => {
    load();
    setReviewsPage(1);
  }, [load]);

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

  const isSpotAdmin = !!myRole && SPOT_ADMIN_ROLES.includes(myRole);

  // 編集・削除できるのは、公開スポットはspot_admin/admin、それ以外(非公開・承認待ち・
  // 却下)は追加した本人のみ(APIのcanEditOrDeleteと同じルール)
  const canManage =
    !!spot &&
    (spot.status === "published" ? isSpotAdmin : spot.created_by === myId);

  // 承認待ち→公開/却下の変更はspot_admin/adminのみ(投稿者本人かどうかは問わない)
  const canModerate = !!spot && spot.status === "pending" && isSpotAdmin;

  // 非公開スポットは口コミの表示・投稿ともに不可
  const reviewsEnabled = useMemo(
    () =>
      spot?.status !== "private" &&
      (spotTypes.find((t) => t.id === spot?.spot_type_id)?.reviews_enabled ??
        true),
    [spotTypes, spot]
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
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onClick={onClose}
    >
      <div
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {loading ? (
          <p className="p-4 text-sm text-gray-500">読み込み中…</p>
        ) : !spot ? (
          <p className="p-4 text-sm text-gray-500">スポットが見つかりません。</p>
        ) : (
          <>
            <div className="mb-3 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <RankBadge rank={spot.rank} />
                <div>
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
                    {canManage && (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowEditForm(true)}
                          className="ml-2 text-xs font-normal text-blue-600 underline"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          onClick={handleDeleteSpot}
                          className="ml-2 text-xs font-normal text-red-500 underline"
                        >
                          削除
                        </button>
                      </>
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
                    {spot.prefecture}
                    {spot.municipality && ` ${spot.municipality}`} ・{" "}
                    {spot.category}
                    {reviewsEnabled && reviewsTotal > 0 && (
                      <span className="ml-2 text-gray-400">
                        口コミ{reviewsTotal}件
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-full px-2 text-xl leading-none text-gray-400"
                aria-label="閉じる"
              >
                ×
              </button>
            </div>

            {spot.description && (
              <p className="mb-3 text-sm text-gray-700">{spot.description}</p>
            )}

            <MiniMap lat={spot.lat} lng={spot.lng} rank={spot.rank} />

            <div className="mt-3 space-y-1">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <Link
                  href={`${typeKey ? `/${typeKey}` : ""}/map?spot=${spot.id}`}
                  className="inline-block text-sm text-blue-600 underline"
                >
                  アプリの地図で開く
                </Link>
                <button
                  type="button"
                  onClick={() => setShowInfo(true)}
                  className="inline-block text-sm text-blue-600 underline"
                >
                  スポット詳細を開く
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    `${spot.name} ${spot.lat},${spot.lng}`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-sm text-blue-600 underline"
                >
                  Google マップで開く ↗
                </a>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
                    `${spot.lat},${spot.lng}`
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-sm text-blue-600 underline"
                >
                  Google マップで経路を表示 ↗
                </a>
                {spot.official_url && (
                  <a
                    href={spot.official_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-sm text-blue-600 underline"
                  >
                    公式サイト ↗
                  </a>
                )}
              </div>
            </div>

            {/* 訪問履歴 */}
            <div className="mt-4 border-t border-gray-100 pt-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-bold">
                  訪問履歴
                  {visits.length > 0 && (
                    <span className="ml-2 text-sm font-normal text-green-600">
                      ✓ {visits.length}回
                    </span>
                  )}
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={toggleVisitPlan}
                    disabled={planUpdating}
                    className={`rounded-lg px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${
                      planned
                        ? "border border-gray-300 text-gray-600"
                        : "border border-blue-600 text-blue-600"
                    }`}
                  >
                    {planned ? "訪問予定をはずす" : "訪問予定にする"}
                  </button>
                  <button
                    onClick={() => setShowForm(true)}
                    className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white"
                  >
                    + 訪問を記録
                  </button>
                </div>
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
                            {formatVisitedOn(
                              visit.visited_on,
                              visit.date_precision
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
                        <button
                          onClick={() => deleteVisit(visit.id)}
                          className="shrink-0 text-xs text-gray-400 hover:text-red-500"
                        >
                          削除
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

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
          </>
        )}
      </div>

      {showForm && spot && (
        <VisitFormModal
          spotId={spot.id}
          spotName={spot.name}
          reviewsEnabled={reviewsEnabled}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
            setReviewsPage(1);
            loadReviews(1);
            onVisitChange?.();
            // 訪問記録時、サーバー側で訪問予定からも自動的に外れる
            onVisitPlanChange?.();
          }}
        />
      )}

      {showInfo && spot && (
        <SpotInfoModal
          spotName={spot.name}
          prefecture={spot.prefecture}
          municipality={spot.municipality}
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
    </div>
  );
}
