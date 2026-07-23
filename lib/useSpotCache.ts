"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { Spot, SpotRoute } from "@/lib/types";
import {
  readSpotCacheDb,
  writeSpotCacheDb,
  deleteSpotCacheDb,
  trimSpot,
  expandSpot,
  type StoredSpotCache,
} from "@/lib/spotCacheDb";

/** アプリ内で扱う公開スポットキャッシュ(spotsは表示用にSpotへ復元済み) */
export interface SpotCacheEntry {
  downloadedAt: string; // ISO
  spots: Spot[];
  /** 公開ルート(公開スポットと同時にダウンロードして保存される) */
  routes: SpotRoute[];
}

const SAVE_ERROR =
  "スポットデータの保存に失敗しました。次に開いたときは再ダウンロードが必要です。";
const DELETE_ERROR = "スポットデータの削除に失敗しました。";

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

/** ダウンロードした公開スポット・公開ルートをキャッシュの保存用エントリにまとめる */
function toStored(spots: Spot[], routes: SpotRoute[]): StoredSpotCache {
  return {
    downloadedAt: new Date().toISOString(),
    spots: spots.map(trimSpot),
    routes,
  };
}

/** 保存用エントリをアプリ内表示用(Spot[])のエントリに戻す */
function toEntry(stored: StoredSpotCache): SpotCacheEntry {
  return {
    downloadedAt: stored.downloadedAt,
    spots: stored.spots.map(expandSpot),
    routes: stored.routes ?? [],
  };
}

// gzip等の圧縮転送ではContent-Lengthは圧縮後サイズで、展開後バイト数とは
// 比較できないため、その場合はサイズ不明(=事前確認できない)扱いにする
function knownContentLength(response: Response): number | null {
  const contentLength = Number(response.headers.get("content-length"));
  return contentLength > 0 && !response.headers.get("content-encoding")
    ? contentLength
    : null;
}

/**
 * レスポンスボディを、受信バイト数をonProgressへ通知しながら読み切ってSpot[]に
 * パースする(フックのreadBodyと、別種別用downloadSpotCacheForの共通部品)。
 * api-clientではなくfetchのReadableStreamを直接読む(レスポンスが大きく数MBに
 * なりうるため)。失敗時はthrowする(中断によるthrowをエラー扱いにするかどうかは
 * 呼び出し側がsignal.abortedで判断する)
 */
async function readSpotsBody(
  response: Response,
  onProgress: (p: DownloadProgress) => void
): Promise<Spot[]> {
  const totalBytes = knownContentLength(response);
  onProgress({ loadedBytes: 0, totalBytes });
  let text: string;
  if (response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const chunks: string[] = [];
    let loadedBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      loadedBytes += value.byteLength;
      chunks.push(decoder.decode(value, { stream: true }));
      onProgress({ loadedBytes, totalBytes });
    }
    chunks.push(decoder.decode());
    text = chunks.join("");
  } else {
    text = await response.text();
  }
  const data = (JSON.parse(text) as { data?: Spot[] }).data;
  if (!data) throw new Error("取得に失敗しました");
  return data;
}

/**
 * 指定種別の公開スポット+公開ルートをダウンロードしてIndexedDBキャッシュへ保存する。
 * useSpotCacheは表示中の種別に固定のため、地図の「別の種別を重ねて表示」のように
 * 別の種別をその場でダウンロードしたい場合はこちらを使う(確認ダイアログ・進捗表示は
 * 呼び出し側が持つ)。中断時はnull、失敗時はErrorをthrowする。
 * 保存の失敗はエラーにしない(このセッションの表示は続けられる。キャッシュに
 * 残らないため、次に開いたときまた未ダウンロード扱いになるだけ)
 */
export async function downloadSpotCacheFor(
  typeKey: string,
  controller: AbortController,
  onProgress: (p: DownloadProgress) => void
): Promise<SpotCacheEntry | null> {
  let spots: Spot[];
  try {
    const qs = new URLSearchParams({ status: "published", type: typeKey });
    const res = await fetch(`/api/spots?${qs.toString()}`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? res.statusText);
    }
    spots = await readSpotsBody(res, onProgress);
  } catch (err) {
    if (controller.signal.aborted) return null;
    throw err;
  }
  // ルートは件数が少なくサイズ確認・進捗表示は不要。取得に失敗しても
  // スポットのダウンロード自体は無駄にしない(ルート無しで続行する)
  const { data } = await api.routes.list(typeKey);
  const routes = (data ?? []).filter((r) => r.status === "published");
  const stored = toStored(spots, routes);
  await writeSpotCacheDb(typeKey, stored).catch(() => {});
  return toEntry(stored);
}

/**
 * 公開スポットは頻繁に変わらないため、ページを開くたびにAPIから取り直すのではなく
 * スポット種別ごとにIndexedDBへ明示的にダウンロード・キャッシュする
 * (/[type]/map・/[type]/spots で共通利用)。未ダウンロードならページを開いたタイミングで
 * 一度だけダウンロード確認ダイアログを出す。
 *
 * 数万件規模の種別でも保存できるよう、保存先はlocalStorage(約5MB上限)
 * ではなくIndexedDBを使い、かつ地図・一覧で使うフィールドだけに間引いて保存する
 * (lib/spotCacheDb.ts)。
 */
export function useSpotCache(typeKey: string) {
  const [entry, setEntry] = useState<SpotCacheEntry | null>(null);
  const [ready, setReady] = useState(false);
  const [showMissingPrompt, setShowMissingPrompt] = useState(false);
  // ダウンロード本体を読む前に、サイズが分かった時点で見せる確認ダイアログ
  // (sizeBytesはContent-Lengthそのもの=これから受信する生JSONのバイト数。
  // 実際にIndexedDBへ保存するのは間引き後のデータのため、保存サイズはこれより小さくなる)
  const [manualConfirm, setManualConfirm] = useState<{ sizeBytes: number } | null>(
    null
  );
  // 手動ダウンロードのヘッダー確認中(まだ本体は読んでいない)。この間はまだ
  // downloading=falseなので、全画面の進捗ダイアログは出さずボタン側だけ待機表示にする
  const [checkingSize, setCheckingSize] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoPromptedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // manualConfirm表示中、ヘッダーだけ受信済みでまだ読んでいないレスポンスを保持する
  const pendingResponseRef = useRef<
    { response: Response; controller: AbortController } | null
  >(null);

  // アンマウント時(ダイアログごと画面が消えるページ遷移等)は進行中・保留中の
  // ダウンロードを打ち切る
  useEffect(
    () => () => {
      abortRef.current?.abort();
      pendingResponseRef.current?.controller.abort();
    },
    []
  );

  // 種別が変わったらキャッシュを非同期に読み直す(IndexedDBアクセスは非同期のため、
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
   * リクエストを送り、レスポンスのヘッダーまで受け取った時点で返す(ボディはまだ読まない)。
   * ここでContent-Lengthが分かれば、ボディを読み始める前にサイズを確認できる。
   * 失敗時はerrorをセットしてnullを返す。
   */
  const openFetch = useCallback(async (): Promise<
    { response: Response; controller: AbortController } | null
  > => {
    const controller = new AbortController();
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
      return { response: res, controller };
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(err instanceof Error ? err.message : "取得に失敗しました");
      }
      return null;
    }
  }, [typeKey]);

  /**
   * openFetchが返したレスポンスのボディを、進捗ダイアログに受信バイト数を出しながら
   * 読み切ってSpot[]にパースする(本体はreadSpotsBody)。キャンセル時はエラー扱いに
   * せずnullを返す。
   */
  const readBody = useCallback(
    async (response: Response, controller: AbortController): Promise<Spot[] | null> => {
      abortRef.current = controller;
      setDownloading(true);
      try {
        return await readSpotsBody(response, setProgress);
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
    },
    []
  );

  /** ヘッダー確認を挟まず、一気に取得する(「未ダウンロードです」ダイアログ用) */
  const fetchPublished = useCallback(async (): Promise<Spot[] | null> => {
    const opened = await openFetch();
    if (!opened) return null;
    return readBody(opened.response, opened.controller);
  }, [openFetch, readBody]);

  /**
   * 公開ルートを取得する(公開スポットのダウンロードと同時にキャッシュへ保存する)。
   * ルートは件数が少なくサイズ確認・進捗表示は不要。取得に失敗しても
   * スポットのダウンロード自体は無駄にしない(ルート無しで保存を続行する)
   */
  const fetchPublicRoutes = useCallback(async (): Promise<SpotRoute[]> => {
    const { data } = await api.routes.list(typeKey);
    return (data ?? []).filter((r) => r.status === "published");
  }, [typeKey]);

  /** 進捗ダイアログの「キャンセル」ボタン: 進行中のダウンロードを打ち切る */
  const cancelDownload = useCallback(() => abortRef.current?.abort(), []);

  /**
   * 歯車メニューの「ダウンロード」ボタン: まずヘッダーだけ受け取り、サイズ
   * (Content-Length、間引き前の生JSONバイト数)が事前にわかる場合だけ本文を読む前に
   * 確認ダイアログを出す。圧縮転送等でサイズが事前にわからない場合は、ダウンロード後に
   * 今さら「ダウンロードしますか?」と聞いても意味がない(既に受信済みのため)ので、
   * 確認なしでそのままダウンロードする。
   */
  const startManualDownload = useCallback(async () => {
    setCheckingSize(true);
    const opened = await openFetch();
    setCheckingSize(false);
    if (!opened) return;

    const sizeBytes = knownContentLength(opened.response);
    if (sizeBytes !== null) {
      pendingResponseRef.current = opened;
      setManualConfirm({ sizeBytes });
      return;
    }

    const data = await readBody(opened.response, opened.controller);
    if (!data) return;
    const stored = toStored(data, await fetchPublicRoutes());
    setEntry(toEntry(stored));
    persist(stored);
  }, [openFetch, readBody, persist, fetchPublicRoutes]);

  const confirmManualDownload = useCallback(async () => {
    const pending = pendingResponseRef.current;
    pendingResponseRef.current = null;
    setManualConfirm(null);
    if (!pending) return;
    const data = await readBody(pending.response, pending.controller);
    if (!data) return;
    const stored = toStored(data, await fetchPublicRoutes());
    setEntry(toEntry(stored));
    persist(stored);
  }, [readBody, persist, fetchPublicRoutes]);

  const cancelManualDownload = useCallback(() => {
    pendingResponseRef.current?.controller.abort();
    pendingResponseRef.current = null;
    setManualConfirm(null);
  }, []);

  /** 「未ダウンロードです」ダイアログで同意したとき */
  const confirmMissingDownload = useCallback(async () => {
    setShowMissingPrompt(false);
    const data = await fetchPublished();
    if (!data) {
      // 失敗・キャンセル時は確認ダイアログに戻す(エラーはそのダイアログ内に表示される)
      setShowMissingPrompt(true);
      return;
    }
    const stored = toStored(data, await fetchPublicRoutes());
    setEntry(toEntry(stored));
    persist(stored);
  }, [fetchPublished, persist, fetchPublicRoutes]);

  const dismissMissingPrompt = useCallback(() => setShowMissingPrompt(false), []);

  /** ダウンロード済みの公開スポットキャッシュを削除する(歯車メニューから明示的に実行) */
  const clearCache = useCallback(async () => {
    // 通常は「entryがnullになった」だけでは未ダウンロードプロンプトの自動表示
    // (autoPromptedRefがまだfalseの場合のみ発火)は起きないが、ダウンロード済みの
    // まま一度もこのプロンプトを出したことのないセッションで削除すると、このタイミングで
    // 初めてentryがnullになるため誤って発火してしまう。削除は明示的な操作なので、
    // 削除直後に「ダウンロードしますか?」を自動で聞き返さないよう先にフラグを立てておく
    autoPromptedRef.current = true;
    setEntry(null);
    try {
      await deleteSpotCacheDb(typeKey);
    } catch {
      setError(DELETE_ERROR);
    }
  }, [typeKey]);

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
        persist({
          downloadedAt: next.downloadedAt,
          spots: next.spots.map(trimSpot),
          routes: next.routes,
        });
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
        persist({
          downloadedAt: next.downloadedAt,
          spots: next.spots.map(trimSpot),
          routes: next.routes,
        });
        return next;
      });
    },
    [persist]
  );

  return {
    publicSpots: entry?.spots ?? null,
    publicRoutes: entry?.routes ?? null,
    downloadedAt: entry?.downloadedAt ?? null,
    ready,
    checkingSize,
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
    clearCache,
    applySpotChange,
    applySpotDelete,
  };
}

export type SpotCache = ReturnType<typeof useSpotCache>;
