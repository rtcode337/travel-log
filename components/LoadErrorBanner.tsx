"use client";

/**
 * 読み込みに失敗したことを知らせる帯。**失敗を「0件」や空の一覧に見せない**ためのもの
 * (通信が切れているだけなのに「記録がありません」と出ると、消えたと思わせてしまう)。
 * 押すと呼び出し側の読み込みをやり直す。
 */
export default function LoadErrorBanner({
  message,
  onRetry,
  className = "",
}: {
  message: string;
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={`flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 ${className}`}
    >
      <p className="min-w-0 flex-1">読み込めなかったデータがあります: {message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium"
      >
        再読み込み
      </button>
    </div>
  );
}
