"use client";

import { formatBytes, type SpotCache } from "@/lib/useSpotCache";

/**
 * 公開スポットのダウンロード確認まわりのダイアログ。
 * 未ダウンロード時の確認と、歯車メニューからの手動ダウンロード確認の両方をここでまとめて描画する
 * (/[type]/map・/[type]/spots で共通利用)。
 */
export default function SpotDownloadDialogs({ cache }: { cache: SpotCache }) {
  return (
    <>
      {cache.showMissingPrompt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4">
            <p className="text-sm text-gray-700">
              スポットデータが未ダウンロードです。ダウンロードしますか?
            </p>
            {cache.error && (
              <p className="mt-2 text-xs text-red-600">{cache.error}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={cache.dismissMissingPrompt}
                disabled={cache.downloading}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm disabled:opacity-50"
              >
                あとで
              </button>
              <button
                type="button"
                onClick={cache.confirmMissingDownload}
                disabled={cache.downloading}
                className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {cache.downloading ? "ダウンロード中…" : "ダウンロード"}
              </button>
            </div>
          </div>
        </div>
      )}

      {cache.manualConfirm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4">
            <p className="text-sm text-gray-700">
              {formatBytes(cache.manualConfirm.sizeBytes)}
              の更新公開スポットデータをダウンロードします。よろしいですか?
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={cache.cancelManualDownload}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={cache.confirmManualDownload}
                className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white"
              >
                ダウンロード
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
