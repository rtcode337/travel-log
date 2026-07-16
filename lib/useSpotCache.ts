"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Spot } from "@/lib/types";
import {
  readSpotCacheDb,
  writeSpotCacheDb,
  trimSpot,
  expandSpot,
  type CachedSpot,
  type StoredSpotCache,
} from "@/lib/spotCacheDb";

/** アプリ内で扱う公開スポットキャッシュ(spotsは表示用にSpotへ復元済み) */
export interface SpotCacheEntry {
  downloadedAt: string; // ISO
  spots: Spot[];
}

const SAVE_ERROR =
  "スポットデータの保存に失敗しました。次に開いたときは再ダウンロードが必要です。";

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export interface DownloadProgress {
  loadedBytes: number;
  /** Content-Lengthから割合を出せる場合のみ(圧縮転送時は受信バイト数と比較できないためnull) */
  totalBytes: number | null;
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

/** ダウンロードした公開スポットをキャッシュ用に間引き、保存用エントリにまとめる */
function toStored(spots: Spot[]): StoredSpotCache {
  return { downloadedAt: new Date().toISOString(), spots: spots.map(trimSpot) };
}

/** 保存用エントリをアプリ内表示用(Spot[])のエントリに戻す */
function toEntry(stored: StoredSpotCache): SpotCacheEntry {
  return { downloadedAt: stored.downloadedAt, spots: stored.spots.map(expandSpot) };
}

/**
 * 公開スポットは頻繁に変わらないため、ページを開くたびにAPIから取り直すのではなく
 * スポット種類ごとにIndexedDBへ明示的にダウンロード・キャッシュする
 * (/[type]/map・/[type]/spots で共通利用)。未ダウンロードならページを開いたタイミングで
 * 一度だけダウンロード確認ダイアログを出す。
 *
 * 郵便局・御朱印など数万件規模の種類でも保存できるよう、保存先はlocalStorage(約5MB上限)
 * ではなくIndexedDBを使い、かつ地図・一覧で使うフィールドだけに間引いて保存する
 * (lib/spotCacheDb.ts)。
 */
export function useSpotCache(typeKey: string) {
  const [entry, setEntry] = useState<SpotCacheEntry | null>(null);
  const [ready, setReady] = useState(false);
  const [showMissingPrompt, setShowMissingPrompt] = useState(false);
  const [manualConfirm, setManualConfirm] = useState<
    { sizeBytes: number; data: CachedSpot[] } | null
  >(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoPromptedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // アンマウント時(ダイアログごと画面が消えるページ遷移等)は進行中のダウンロードを打ち切る
  useEffect(() => () => abortRef.current?.abort(), []);

  // 種類が変わったらキャッシュを非同期に読み直す(IndexedDBアクセスは非同期のため、
  // 読み込み完了までready=falseにして、その間は未ダウンロード扱いのプロンプトを出さない)
  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setEntry(null);
    autoPromptedRef.current = false;
    (async () => {
      const stored = await readSpotCacheDb(typeKey);
      if (cancelled) return;
      setEntry(stored ? toEntry(stored) : null);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [typeKey]);

  useEffect(() => {
    if (!ready || autoPromptedRef.current || entry) return;
    autoPromptedRef.current = true;
    setShowMissingPrompt(true);
  }, [ready, entry]);

  /** ダウンロード済みデータを保存する。保存に失敗してもこのセッションの表示は続けられる */
  const persist = useCallback(
    (stored: StoredSpotCache) => {
      writeSpotCacheDb(typeKey, stored).catch(() => setError(SAVE_ERROR));
    },
    [typeKey]
  );

  /**
   * 公開スポットを取得する。進捗ダイアログに受信バイト数を出すため、api-clientではなく
   * fetchのReadableStreamを直接読む(レスポンスが大きく数MBになりうるため)。
   * キャンセル時はエラー扱いにせずnullを返す。
   */
  const fetchPublished = useCallback(async (): Promise<Spot[] | null> => {
    const controller = new AbortController();
    abortRef.current = controller;
    setDownloading(true);
    setProgress({ loadedBytes: 0, totalBytes: null });
    setError(null);
    try {
      const qs = new URLSearchParams({ status: "published", type: typeKey });
      const res = await fetch(`/api/spots?${qs.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error ?? res.statusText);
        return null;
      }

      // gzip等の圧縮転送ではContent-Lengthは圧縮後サイズで、reader側で数える
      // 展開後バイト数とは比較できないため、その場合は割合なし(バイト数のみ)で表示する
      const contentLength = Number(res.headers.get("content-length"));
      const totalBytes =
        contentLength > 0 && !res.headers.get("content-encoding")
          ? contentLength
          : null;

      let text: string;
      if (res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        const chunks: string[] = [];
        let loadedBytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          loadedBytes += value.byteLength;
          chunks.push(decoder.decode(value, { stream: true }));
          setProgress({ loadedBytes, totalBytes });
        }
        chunks.push(decoder.decode());
        text = chunks.join("");
      } else {
        text = await res.text();
      }

      const data = (JSON.parse(text) as { data?: Spot[] }).data;
      if (!data) {
        setError("取得に失敗しました");
        return null;
      }
      return data;
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "取得に失敗しました");
      }
      return null;
    } finally {
      abortRef.current = null;
      setDownloading(false);
      setProgress(null);
    }
  }, [typeKey]);

  /** 進捗ダイアログの「キャンセル」ボタン: 進行中のダウンロードを打ち切る */
  const cancelDownload = useCallback(() => abortRef.current?.abort(), []);

  /** 歯車メニューの「ダウンロード」ボタン: 先に取得して(間引き後の)サイズを確認ダイアログに出す */
  const startManualDownload = useCallback(async () => {
    const data = await fetchPublished();
    if (!data) return;
    const trimmed = data.map(trimSpot);
    const sizeBytes = new TextEncoder().encode(JSON.stringify(trimmed)).length;
    setManualConfirm({ sizeBytes, data: trimmed });
  }, [fetchPublished]);

  const confirmManualDownload = useCallback(() => {
    if (!manualConfirm) return;
    const stored: StoredSpotCache = {
      downloadedAt: new Date().toISOString(),
      spots: manualConfirm.data,
    };
    setEntry(toEntry(stored));
    setManualConfirm(null);
    persist(stored);
  }, [manualConfirm, persist]);

  const cancelManualDownload = useCallback(() => setManualConfirm(null), []);

  /** 「未ダウンロードです」ダイアログで同意したとき */
  const confirmMissingDownload = useCallback(async () => {
    setShowMissingPrompt(false);
    const data = await fetchPublished();
    if (!data) {
      // 失敗・キャンセル時は確認ダイアログに戻す(エラーはそのダイアログ内に表示される)
      setShowMissingPrompt(true);
      return;
    }
    const stored = toStored(data);
    setEntry(toEntry(stored));
    persist(stored);
  }, [fetchPublished, persist]);

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
        persist({ downloadedAt: next.downloadedAt, spots: next.spots.map(trimSpot) });
        return next;
      });
    },
    [persist]
  );

  const applySpotDelete = useCallback(
    (spotId: string) => {
      setEntry((prev) => {
        if (!prev) return prev;
        if (!prev.spots.some((s) => s.id === spotId)) return prev;
        const next = { ...prev, spots: prev.spots.filter((s) => s.id !== spotId) };
        persist({ downloadedAt: next.downloadedAt, spots: next.spots.map(trimSpot) });
        return next;
      });
    },
    [persist]
  );

  return {
    publicSpots: entry?.spots ?? null,
    downloadedAt: entry?.downloadedAt ?? null,
    ready,
    downloading,
    progress,
    error,
    showMissingPrompt,
    manualConfirm,
    startManualDownload,
    cancelDownload,
    confirmManualDownload,
    cancelManualDownload,
    confirmMissingDownload,
    dismissMissingPrompt,
    applySpotChange,
    applySpotDelete,
  };
}

export type SpotCache = ReturnType<typeof useSpotCache>;
