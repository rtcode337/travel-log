"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { exportsEnabled } from "@/lib/features";
import type { ExportJob } from "@/lib/types";

/** 生成が長引いている実行中ジョブを失敗扱いにする閾値(コンテナが落ちるとrunningのまま残る) */
export const STALE_RUNNING_MS = 60 * 60 * 1000;

/** 実行中のまま長時間止まっているか(コンテナ再起動でrunningが残った場合) */
export function isStaleRunning(job: ExportJob): boolean {
  return (
    job.status === "running" &&
    Date.now() - new Date(job.created_at).getTime() > STALE_RUNNING_MS
  );
}

/**
 * 訪問記録エクスポートのジョブ一覧を、**生成中は追いかけながら**保持する。
 * 管理画面(`ExportJobsPanel`)とアカウント画面(`AccountView`)で共用する。
 *
 * 状態はサーバー側で running → done へ勝手に進むので、取り直しの機会を3つ用意する:
 *
 * - **画面を開いたとき**(マウント)。管理画面とアカウント画面を行き来するだけで
 *   最新になる
 * - **生成中は3秒ごと**。開いたまま待っている人の画面が、リロードなしで完了に変わる
 * - **画面が表に戻ったとき**(`visibilitychange`/`focus`)。裏に回っている間は
 *   ブラウザがタイマーを間引く/止めるため、戻った直後に古い状態が出るのを防ぐ
 *
 * 取得は`api.exports.list()`で、これはタブ内のGETキャッシュを使わない
 * (使うと最初の結果が返り続け、リロードするまで作成中のまま固まる)。
 */
export function useExportJobs() {
  const [jobs, setJobs] = useState<ExportJob[]>([]);

  const load = useCallback(async () => {
    // 機能ごと畳んである環境では取りに行かない(APIは503を返す)
    if (!exportsEnabled) return;
    const { data } = await api.exports.list();
    setJobs(data ?? []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // 依存に jobs ではなく boolean を置く。jobs だと取り直すたびにタイマーを
  // 張り直すことになり、3秒の間隔が毎回リセットされる
  const hasRunning = jobs.some(
    (job) => job.status === "running" && !isStaleRunning(job)
  );

  useEffect(() => {
    if (!hasRunning) return;
    const timer = setInterval(load, 3000);
    return () => clearInterval(timer);
  }, [hasRunning, load]);

  useEffect(() => {
    if (!hasRunning) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", load);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", load);
    };
  }, [hasRunning, load]);

  return { jobs, reload: load };
}
