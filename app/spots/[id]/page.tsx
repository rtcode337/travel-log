"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  formatVisitedOn,
  type Spot,
  type Visit,
} from "@/lib/types";
import RankBadge from "@/components/RankBadge";
import MiniMap from "@/components/MiniMap";
import VisitFormModal from "@/components/VisitFormModal";

export default function SpotDetailPage() {
  const params = useParams<{ id: string }>();
  const spotId = params.id;

  const [spot, setSpot] = useState<Spot | null>(null);
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const [{ data: spotData }, { data: visitsData }] = await Promise.all([
      supabase.from("spots").select("*").eq("id", spotId).single(),
      supabase
        .from("visits")
        .select("*")
        .eq("spot_id", spotId)
        .order("visited_on", { ascending: false, nullsFirst: false }),
    ]);
    setSpot(spotData as Spot | null);
    setVisits((visitsData as Visit[]) ?? []);
    setLoading(false);
  }, [spotId]);

  useEffect(() => {
    load();
  }, [load]);

  const deleteVisit = async (id: string) => {
    if (!confirm("この訪問記録を削除しますか?")) return;
    const supabase = createClient();
    await supabase.from("visits").delete().eq("id", id);
    load();
  };

  if (loading) {
    return (
      <main className="p-4">
        <p className="text-sm text-gray-500">読み込み中…</p>
      </main>
    );
  }

  if (!spot) {
    return (
      <main className="p-4">
        <p className="text-sm text-gray-500">スポットが見つかりません。</p>
        <Link href="/spots" className="text-sm text-blue-600 underline">
          リストへ戻る
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-lg p-4">
      <Link href="/spots" className="mb-3 inline-block text-sm text-gray-500">
        ← リストへ
      </Link>

      {/* 基本情報 */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-2 flex items-center gap-2">
          <RankBadge rank={spot.rank} />
          <div>
            <h1 className="text-lg font-bold leading-tight">{spot.name}</h1>
            <p className="text-xs text-gray-500">
              {spot.prefecture}
              {spot.municipality && ` ${spot.municipality}`} ・ {spot.category}
            </p>
          </div>
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
      </div>

      {/* 訪問履歴 */}
      <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-bold">
            訪問履歴
            {visits.length > 0 && (
              <span className="ml-2 text-sm font-normal text-green-600">
                ✓ {visits.length}回
              </span>
            )}
          </h2>
          <button
            onClick={() => setShowForm(true)}
            className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white"
          >
            + 訪問を記録
          </button>
        </div>
        {visits.length === 0 ? (
          <p className="text-sm text-gray-500">まだ訪問記録がありません。</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {visits.map((visit) => (
              <li key={visit.id} className="py-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">
                      {formatVisitedOn(visit.visited_on, visit.date_precision)}
                    </p>
                    {visit.memo && (
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-gray-600">
                        {visit.memo}
                      </p>
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

      {showForm && (
        <VisitFormModal
          spotId={spot.id}
          spotName={spot.name}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}
    </main>
  );
}
