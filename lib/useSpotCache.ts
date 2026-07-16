"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { Spot } from "@/lib/types";

const CACHE_PREFIX = "travel-log:public-spots:";

export interface SpotCacheEntry {
  downloadedAt: string; // ISO
  spots: Spot[];
}

function cacheKey(typeKey: string): string {
  return `${CACHE_PREFIX}${typeKey}`;
}

export function readSpotCache(typeKey: string): SpotCacheEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cacheKey(typeKey));
    return raw ? (JSON.parse(raw) as SpotCacheEntry) : null;
  } catch {
    return null;
  }
}

function writeSpotCache(typeKey: string, spots: Spot[]): SpotCacheEntry {
  const entry: SpotCacheEntry = { downloadedAt: new Date().toISOString(), spots };
  window.localStorage.setItem(cacheKey(typeKey), JSON.stringify(entry));
  return entry;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export function formatDownloadedAt(iso: string): string {
  return new Date(iso).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 公開スポットは頻繁に変わらないため、ページを開くたびにAPIから取り直すのではなく
 * スポット種類ごとにlocalStorageへ明示的にダウンロード・キャッシュする
 * (/[type]/map・/[type]/spots で共通利用)。未ダウンロードならページを開いたタイミングで
 * 一度だけダウンロード確認ダイアログを出す。
 */
export function useSpotCache(typeKey: string) {
  const [entry, setEntry] = useState<SpotCacheEntry | null>(null);
  const [ready, setReady] = useState(false);
  const [showMissingPrompt, setShowMissingPrompt] = useState(false);
  const [manualConfirm, setManualConfirm] = useState<
    { sizeBytes: number; data: Spot[] } | null
  >(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoPromptedRef = useRef(false);

  useEffect(() => {
    setEntry(readSpotCache(typeKey));
    setReady(true);
    autoPromptedRef.current = false;
  }, [typeKey]);

  useEffect(() => {
    if (!ready || autoPromptedRef.current || entry) return;
    autoPromptedRef.current = true;
    setShowMissingPrompt(true);
  }, [ready, entry]);

  const fetchPublished = useCallback(async (): Promise<Spot[] | null> => {
    setDownloading(true);
    setError(null);
    const { data, error: err } = await api.spots.list("published", { type: typeKey });
    setDownloading(false);
    if (err || !data) {
      setError(err?.message ?? "取得に失敗しました");
      return null;
    }
    return data;
  }, [typeKey]);

  /** 歯車メニューの「ダウンロード」ボタン: 先に取得してサイズを確認ダイアログに出す */
  const startManualDownload = useCallback(async () => {
    const data = await fetchPublished();
    if (!data) return;
    const sizeBytes = new TextEncoder().encode(JSON.stringify(data)).length;
    setManualConfirm({ sizeBytes, data });
  }, [fetchPublished]);

  const confirmManualDownload = useCallback(() => {
    if (!manualConfirm) return;
    setEntry(writeSpotCache(typeKey, manualConfirm.data));
    setManualConfirm(null);
  }, [manualConfirm, typeKey]);

  const cancelManualDownload = useCallback(() => setManualConfirm(null), []);

  /** 「未ダウンロードです」ダイアログで同意したとき */
  const confirmMissingDownload = useCallback(async () => {
    setShowMissingPrompt(false);
    const data = await fetchPublished();
    if (data) setEntry(writeSpotCache(typeKey, data));
  }, [fetchPublished, typeKey]);

  const dismissMissingPrompt = useCallback(() => setShowMissingPrompt(false), []);

  /**
   * スポット詳細からの編集・承認/却下でこの端末が直接変更した1件だけを、
   * 次回の明示ダウンロードを待たずにキャッシュへ反映する(公開状態ならupsert、
   * それ以外なら除去)。それ以外の変更(他ユーザーの操作等)は次のダウンロードまで反映されない。
   */
  const applySpotChange = useCallback(
    (spot: Spot) => {
      setEntry((prev) => {
        if (!prev) return prev;
        const exists = prev.spots.some((s) => s.id === spot.id);
        const spots =
          spot.status === "published"
            ? exists
              ? prev.spots.map((s) => (s.id === spot.id ? spot : s))
              : [...prev.spots, spot]
            : prev.spots.filter((s) => s.id !== spot.id);
        const next = { ...prev, spots };
        window.localStorage.setItem(cacheKey(typeKey), JSON.stringify(next));
        return next;
      });
    },
    [typeKey]
  );

  const applySpotDelete = useCallback(
    (spotId: string) => {
      setEntry((prev) => {
        if (!prev) return prev;
        if (!prev.spots.some((s) => s.id === spotId)) return prev;
        const next = { ...prev, spots: prev.spots.filter((s) => s.id !== spotId) };
        window.localStorage.setItem(cacheKey(typeKey), JSON.stringify(next));
        return next;
      });
    },
    [typeKey]
  );

  return {
    publicSpots: entry?.spots ?? null,
    downloadedAt: entry?.downloadedAt ?? null,
    ready,
    downloading,
    error,
    showMissingPrompt,
    manualConfirm,
    startManualDownload,
    confirmManualDownload,
    cancelManualDownload,
    confirmMissingDownload,
    dismissMissingPrompt,
    applySpotChange,
    applySpotDelete,
  };
}

export type SpotCache = ReturnType<typeof useSpotCache>;
