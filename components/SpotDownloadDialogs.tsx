"use client";

import { formatBytes, type SpotCache } from "@/lib/useSpotCache";

/**
 * 公開スポットのダウンロード確認まわりのダイアログ。
 * 未ダウンロード時の確認と、歯車メニューからの手動ダウンロード確認の両方をここでまとめて描画する
 * (/[type]/map・/[type]/spots で共通利用)。
 * ダウンロード中は全画面を覆う進捗ダイアログを最前面(NavBar・他ダイアログより上)に出し、
 * 完了までタブ移動などの操作をできなくする。
 */
export default function SpotDownloadDialogs({ cache }: { cache: SpotCache }) {
  const percent =
    cache.progress?.totalBytes != null
      ? Math.min(
          100,
          Math.round((cache.progress.loadedBytes / cache.progress.totalBytes) * 100)
        )
      : null;

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
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm"
              >
                あとで
              </button>
              <button
                type="button"
                onClick={cache.confirmMissingDownload}
                className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white"
              >
                ダウンロード
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
            <p className="mt-1 text-xs text-gray-400">
              (実際に端末に保存されるサイズはこれより小さくなります)
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

      {/* ダウンロード中の進捗。NavBar(z-40)や上の確認ダイアログ(z-[70])より上に重ね、
          背面クリックを全て遮ることで完了まで他のタブへ移動できないようにする */}
      {cache.downloading && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4">
            <p className="text-sm font-medium text-gray-700">
              スポットデータをダウンロード中…
            </p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-200">
              <div
                className={
                  percent != null
                    ? "h-full rounded-full bg-blue-600 transition-[width] duration-200"
                    : "h-full w-1/3 animate-pulse rounded-full bg-blue-600"
                }
                style={percent != null ? { width: `${percent}%` } : undefined}
              />
            </div>
            <p className="mt-2 text-xs text-gray-500">
              {cache.progress
                ? percent != null && cache.progress.totalBytes != null
                  ? `${formatBytes(cache.progress.loadedBytes)} / ${formatBytes(cache.progress.totalBytes)}(${percent}%)`
                  : `${formatBytes(cache.progress.loadedBytes)} 受信済み`
                : "接続中…"}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              ダウンロードが完了するまで他の画面には移動できません。
            </p>
            <button
              type="button"
              onClick={cache.cancelDownload}
              className="mt-3 w-full rounded-lg border border-gray-300 py-2 text-sm"
            >
              キャンセル
            </button>
          </div>
        </div>
      )}
    </>
  );
}
