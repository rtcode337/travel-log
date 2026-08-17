"use client";

import { formatPlanDateRange } from "@/lib/planListDraft";
import { formatVisitedOn, type VisitPlanList } from "@/lib/types";

/**
 * アーカイブした訪問予定リストの一覧(スポット画面の「訪問予定リスト」から開く)。
 *
 * **アーカイブは削除ではない**ので、しまったものを読み直す場所が要る。
 * タップすると呼び出し元がいつもの詳細モーダルを開く —— 経由スポットの表示・
 * 並び替え・アーカイブから戻す操作は、現役のリストとまったく同じ画面で足りる。
 *
 * **一覧そのものは呼び出し元が持つ**(`?archived=1`で引いたもの)。ここで
 * 読み込むと、開いたまま「アーカイブから戻す」を押したときに手元が古いままになる。
 */
export default function PlanListArchiveModal({
  lists,
  onClose,
  onOpenList,
}: {
  /** アーカイブしたリスト(新しくしまった順) */
  lists: VisitPlanList[];
  onClose: () => void;
  /** リストがタップされたときに呼ばれる(呼び出し元が詳細モーダルを開く) */
  onOpenList: (listId: string) => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-lg font-bold leading-tight">
              アーカイブした訪問予定リスト
            </h2>
            <p className="mt-0.5 text-xs text-gray-500">
              回り終わってしまった旅程です。中身はそのまま残っていて、
              詳細から「アーカイブから戻す」といつもの一覧に戻ります。
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="rounded-full px-2 text-xl leading-none text-gray-400"
          >
            ×
          </button>
        </div>

        {lists.length === 0 ? (
          <p className="text-sm text-gray-500">
            アーカイブしたリストはありません。訪問予定リストの詳細から
            アーカイブできます。
          </p>
        ) : (
          <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
            {lists.map((list) => (
              <li key={list.id}>
                <button
                  onClick={() => onOpenList(list.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm"
                    aria-hidden
                  >
                    🗄️
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{list.title}</p>
                    <p className="text-xs text-gray-500">
                      {formatPlanDateRange(list.start_date, list.end_date)}
                      {" ・ "}
                      {list.spot_ids.length}スポット
                      {list.visited_spot_ids.length > 0 &&
                        `(訪問済み ${list.visited_spot_ids.length})`}
                    </p>
                    {list.archived_at && (
                      <p className="text-xs text-gray-400">
                        {formatVisitedOn(list.archived_at)}にアーカイブ
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-gray-400">›</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
