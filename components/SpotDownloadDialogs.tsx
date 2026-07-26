"use client";

import {
  formatBytes,
  type DownloadProgress,
  type SpotCache,
} from "@/lib/useSpotCache";

/**
 * ダウンロード中の進捗ダイアログ。NavBar(z-40)や確認ダイアログ(z-[70])より上に
 * 重ね、背面クリックを全て遮ることで完了まで他のタブへ移動できないようにする。
 * 表示中の種別のダウンロード(SpotDownloadDialogs)と、地図の「別の種別を重ねて表示」
 * からの別種別ダウンロード(MapView)で共通利用する
 */
export function DownloadProgressDialog({
  progress,
  onCancel,
}: {
  progress: DownloadProgress | null;
  onCancel: () => void;
}) {
  const percent =
    progress?.totalBytes != null
      ? Math.min(100, Math.round((progress.loadedBytes / progress.totalBytes) * 100))
      : null;

  return (
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
          {progress
            ? percent != null && progress.totalBytes != null
              ? `${formatBytes(progress.loadedBytes)} / ${formatBytes(progress.totalBytes)}(${percent}%)`
              : `${formatBytes(progress.loadedBytes)} 受信済み`
            : "接続中…"}
        </p>
        <p className="mt-1 text-xs text-gray-400">
          ダウンロードが完了するまで他の画面には移動できません。
        </p>
        <button
          type="button"
          onClick={onCancel}
          className="mt-3 w-full rounded-lg border border-gray-300 py-2 text-sm"
        >
          キャンセル
        </button>
      </div>
    </div>
  );
}

/**
 * 公開スポットのダウンロード確認まわりのダイアログ。
 * 地図を開いたときの自動確認(未ダウンロード時と、ダウンロード済みキャッシュより
 * 新しい更新がサーバーにあるとき)と、歯車メニューからの手動ダウンロード確認の両方を
 * ここでまとめて描画する(/[type]/map・/[type]/spots で共通利用。ただし一覧側は
 * autoPrompt: falseで自動確認を出さないため、実際に表示されるのは地図のみ)。
 * ダウンロード中は全画面を覆う進捗ダイアログを最前面(NavBar・他ダイアログより上)に出し、
 * 完了までタブ移動などの操作をできなくする。
 */
export default function SpotDownloadDialogs({ cache }: { cache: SpotCache }) {
  return (
    <>
      {cache.downloadPrompt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4">
            <p className="text-sm text-gray-700">
              {cache.downloadPrompt === "stale"
                ? "スポットデータが更新されています。最新のデータをダウンロードしますか?"
                : "スポットデータが未ダウンロードです。ダウンロードしますか?"}
            </p>
            {cache.error && (
              <p className="mt-2 text-xs text-red-600">{cache.error}</p>
            )}
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={cache.dismissDownloadPrompt}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm"
              >
                あとで
              </button>
              <button
                type="button"
                onClick={cache.confirmDownloadPrompt}
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

      {cache.downloading && (
        <DownloadProgressDialog
          progress={cache.progress}
          onCancel={cache.cancelDownload}
        />
      )}
    </>
  );
}
