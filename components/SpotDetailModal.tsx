"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { formatVisitedOn, type PublicReview, type Spot, type Visit } from "@/lib/types";
import RankBadge from "@/components/RankBadge";
import MiniMap from "@/components/MiniMap";
import VisitFormModal from "@/components/VisitFormModal";

export default function SpotDetailModal({
  spotId,
  onClose,
  onVisitChange,
}: {
  spotId: string;
  onClose: () => void;
  /** 訪問記録の追加・削除があったときに呼ばれる(呼び出し元の一覧・バッジ更新用) */
  onVisitChange?: () => void;
}) {
  const [spot, setSpot] = useState<Spot | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [reviews, setReviews] = useState<PublicReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    const [{ data: spotData }, { data: visitsData }, { data: reviewsData }] =
      await Promise.all([
        api.spots.get(spotId),
        api.visits.list(spotId),
        api.reviews.list(spotId),
      ]);
    setSpot(spotData ?? null);
    setVisits(visitsData ?? []);
    setReviews(reviewsData ?? []);
    setLoading(false);
  }, [spotId]);

  useEffect(() => {
    load();
  }, [load]);

  const deleteVisit = async (id: string) => {
    if (!confirm("この訪問記録を削除しますか?")) return;
    await api.visits.delete(id);
    load();
    onVisitChange?.();
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
                  </h2>
                  <p className="text-xs text-gray-500">
                    {spot.prefecture}
                    {spot.municipality && ` ${spot.municipality}`} ・{" "}
                    {spot.category}
                    {reviews.length > 0 && (
                      <span className="ml-2 text-gray-400">
                        口コミ{reviews.length}件
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

            {spot.official_url && (
              <a
                href={spot.official_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-sm text-blue-600 underline"
              >
                公式サイト ↗
              </a>
            )}

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
                <button
                  onClick={() => setShowForm(true)}
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white"
                >
                  + 訪問を記録
                </button>
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
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={i}
                                  src={photo}
                                  alt=""
                                  className="h-14 w-14 rounded-lg object-cover"
                                />
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

            {/* 口コミ(公開) */}
            <div className="mt-4 border-t border-gray-100 pt-4">
              <h3 className="mb-3 font-bold">口コミ</h3>
              {reviews.length === 0 ? (
                <p className="text-sm text-gray-500">
                  まだ口コミがありません。
                </p>
              ) : (
                <ul className="space-y-3">
                  {reviews.map((review) => (
                    <li key={review.id}>
                      <span className="text-xs text-gray-400">
                        {review.user_email}
                      </span>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-700">
                        {review.body}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>

      {showForm && spot && (
        <VisitFormModal
          spotId={spot.id}
          spotName={spot.name}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
            onVisitChange?.();
          }}
        />
      )}
    </div>
  );
}
