"use client";

import { useRef } from "react";
import type { Spot } from "@/lib/types";
import {
  findSeriesStyle,
  UNSET_SERIES,
  type SeriesStyleDefinition,
} from "@/lib/seriesStyle";
import { useDragReorder, REORDER_HANDLE_CLASS } from "@/lib/useDragReorder";
import HelpTip from "@/components/HelpTip";

/**
 * 訪問予定リスト作成モードで地図の右側に出すパネル。リストのタイトルと、
 * 選択済みスポットの一覧(左端の三本線ハンドルをつかんでドラッグで並び替え)、
 * 「入力完了」ボタンを表示する。並び替えは`useDragReorder`(リスト詳細・経路詳細と共通)。
 * シリーズは名前のバッジではなく色玉(シリーズの色+縁取り)で示す
 * (シリーズ名が長いとスポット名の幅を食って何行にも折り返してしまうため)。
 */
export default function PlanBuildPanel({
  title,
  editing = false,
  spotIds,
  spotsById,
  seriesStyles,
  saving,
  onReorder,
  onRemove,
  onComplete,
  onCancel,
}: {
  title: string;
  /** 既存リストの編集中なら見出し・ボタンの文言を「編集/更新」にする */
  editing?: boolean;
  spotIds: string[];
  spotsById: Map<string, Spot>;
  seriesStyles: SeriesStyleDefinition[];
  saving: boolean;
  onReorder: (spotIds: string[]) => void;
  onRemove: (spotId: string) => void;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  // 下書きはlocalStorageに持つだけなので、並びが決まった時点(onCommit)ではなく
  // 動かすたびに親へ渡す(地図の下書き経路をその場で追従させるため)
  const { setRowRef, dragIndex, handleProps } = useDragReorder({
    items: spotIds,
    onReorder,
    scrollRef: listRef,
  });

  return (
    <div className="absolute bottom-0 right-0 top-40 z-20 flex w-2/5 max-w-sm flex-col overflow-hidden rounded-tl-xl bg-white/95 shadow-xl backdrop-blur">
      <div className="border-b border-gray-200 p-3">
        <p className="text-xs text-gray-500">
          訪問予定リストを{editing ? "編集中" : "作成中"}
        </p>
        <h2 className="break-words font-bold leading-snug">{title}</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          ピンをタップして追加({spotIds.length}件)
        </p>
      </div>

      <ul
        ref={listRef}
        className="min-h-0 flex-1 divide-y divide-gray-100 overflow-y-auto"
      >
        {spotIds.length === 0 && (
          <li className="p-3 text-xs text-gray-500">
            地図のピンをタップすると、ここに追加されます。左端の≡をつかんで動かすと並び替えできます。
          </li>
        )}
        {spotIds.map((spotId, i) => {
          const spot = spotsById.get(spotId);
          // シリーズ未設定(null/空)は「未設定」の見た目・名前で示す
          const style = spot ? findSeriesStyle(spot.series, seriesStyles) : null;
          const seriesName =
            spot && spot.series && spot.series.length > 0
              ? spot.series
              : UNSET_SERIES;
          return (
            <li
              key={spotId}
              ref={setRowRef(i)}
              className={`flex select-none items-center gap-2 py-1.5 pr-2.5 ${
                dragIndex === i ? "bg-blue-100" : ""
              }`}
            >
              {/* 並び替えハンドル。touch-action: noneはここにだけ当てる
                  (行本体まで当てると一覧がタッチスクロールできなくなる) */}
              <span
                {...handleProps(i)}
                className={`${REORDER_HANDLE_CLASS} self-stretch py-1 pl-2.5 pr-1 text-base leading-none`}
              >
                <span className="flex h-full items-center">≡</span>
              </span>
              {spot && style ? (
                <>
                  {/* シリーズは色玉で示す(名前のバッジだと長いシリーズ名が
                      スポット名の幅を食うため出さない。名前はtitleで確認できる) */}
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-full"
                    title={seriesName}
                    style={{
                      backgroundColor: style.color,
                      border: `1.5px ${
                        spot.status === "private" ? "dashed" : "solid"
                      } ${style.borderColor}`,
                    }}
                  />
                  <span className="min-w-0 flex-1 break-words text-sm leading-snug">
                    {spot.name}
                  </span>
                </>
              ) : (
                <span className="flex min-w-0 flex-1 items-center gap-1 break-words text-sm text-gray-400">
                  (読み込み中のスポット)
                  <HelpTip sheet>
                    そのスポットの情報が手元に無いときの表示です。IDから
                    取り直している最中なら、終わりしだい名前に変わります。
                    いつまでも変わらないときは、
                    <b>スポットが削除された</b>・
                    <b>他の人の非公開スポットで見られない</b>・
                    <b>通信に失敗した</b>のいずれかです。
                    名前が出ていなくても並び替え・削除はでき、そのまま保存してもリストからは外れません。
                  </HelpTip>
                </span>
              )}
              <button
                type="button"
                aria-label="削除"
                onClick={() => onRemove(spotId)}
                className="shrink-0 px-1 text-lg leading-none text-gray-400 hover:text-red-500"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>

      <div className="space-y-2 border-t border-gray-200 p-3">
        <button
          type="button"
          onClick={onComplete}
          disabled={saving || spotIds.length === 0}
          className="w-full rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "保存中…" : editing ? "更新" : "入力完了"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="w-full rounded-lg border border-gray-300 py-2 text-sm text-gray-600 disabled:opacity-50"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}
