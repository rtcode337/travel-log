"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { isStaleRunning, useExportJobs } from "@/lib/useExportJobs";
import type { ExportJob } from "@/lib/types";

function formatBytes(size: number | null): string {
  if (size === null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP");
}

/**
 * 訪問記録エクスポートの管理パネル(管理画面のadmin専用セクション)。
 * 対象ユーザーのメールアドレスを指定して生成を始め、出来上がったZIPを
 * ここからダウンロードできる。対象ユーザー自身はアカウント画面から落とせる。
 *
 * 生成はサーバー側のバックグラウンドで進むため、実行中は数秒ごとに一覧を取り直す。
 */
export default function ExportJobsPanel() {
  // 一覧の取得・生成中の追いかけはフックが持つ(アカウント画面と共用)
  const { jobs, reload } = useExportJobs();
  const [email, setEmail] = useState("");
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleStart = async (e: React.FormEvent) => {
    e.preventDefault();
    setStarting(true);
    setError(null);
    setMessage(null);
    const { data, error } = await api.exports.create(email.trim());
    setStarting(false);
    if (error) {
      setError(error.message);
      return;
    }
    setMessage(`${data?.user_email} のエクスポートを開始しました。`);
    setEmail("");
    reload();
  };

  const handleDelete = async (job: ExportJob) => {
    if (!confirm(`${job.user_email} のエクスポート結果を削除しますか?`)) return;
    const { error } = await api.exports.delete(job.id);
    if (error) {
      setError("削除に失敗しました: " + error.message);
      return;
    }
    reload();
  };

  return (
    // 既定は畳んでおく(生成を始めるときだけ開く場所なので)。
    // 管理画面の他の節と同じdetails/summaryの体裁にそろえる
    <details>
      <summary className="cursor-pointer select-none text-base font-bold">
        訪問記録のエクスポート
      </summary>
    <section className="mt-2">
      <p className="mb-2 text-xs text-gray-500">
        指定したユーザーの訪問記録(メモ・写真)を全スポット種別ぶんまとめてZIPにする。
        生成はバックグラウンドで進み、出来上がるとここと本人のアカウント画面から
        ダウンロードできる。同じユーザーのZIPは最新の1件だけ残る。
      </p>

      <form onSubmit={handleStart} className="mb-3 flex gap-2">
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="対象ユーザーのメールアドレス"
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
        />
        <button
          type="submit"
          disabled={starting}
          className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {starting ? "開始中…" : "作成"}
        </button>
      </form>

      {message && (
        <p className="mb-2 rounded-lg bg-blue-50 p-2 text-sm text-blue-800">
          {message}
        </p>
      )}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}

      <ul className="divide-y divide-gray-200 overflow-hidden rounded-xl border border-gray-200 bg-white">
        {jobs.map((job) => (
          <li key={job.id} className="flex items-center gap-2 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{job.user_email}</p>
              <p className="text-xs text-gray-500">
                {formatDateTime(job.created_at)}
                {job.status === "done" && (
                  <>
                    {" ・ "}
                    {job.visit_count}件の記録 / 写真{job.photo_count}枚 ・{" "}
                    {formatBytes(job.file_size)}
                  </>
                )}
                {job.status === "running" &&
                  (isStaleRunning(job)
                    ? " ・ 実行中のまま止まっています(削除して再実行してください)"
                    : " ・ 作成中…")}
                {job.status === "failed" && ` ・ 失敗: ${job.error ?? ""}`}
              </p>
            </div>
            {job.status === "done" && (
              <a
                href={api.exports.downloadUrl(job.id)}
                className="shrink-0 rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
              >
                ⬇ ダウンロード
              </a>
            )}
            <button
              type="button"
              onClick={() => handleDelete(job)}
              className="shrink-0 rounded-lg border border-red-300 px-2.5 py-1 text-xs text-red-600 hover:bg-red-50"
            >
              削除
            </button>
          </li>
        ))}
        {jobs.length === 0 && (
          <li className="px-3 py-3 text-sm text-gray-500">
            まだエクスポートはありません。
          </li>
        )}
      </ul>
    </section>
    </details>
  );
}
