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
  /** ダウンロードしたデータの中で最も新しいupdated_at(鮮度チェック用。旧エントリはnull) */
  latestUpdatedAt: string | null;
  spots: Spot[];
  /** 公開ルート(公開スポットと同時にダウンロードして保存される) */
  routes: SpotRoute[];
}

/** ダウンロード確認ダイアログを出す理由(未ダウンロード / キャッシュより新しい更新がある) */
export type SpotDownloadPromptReason = "missing" | "stale";

/**
 * 公開スポットのダウンロードを何件ずつに分けて取るか。
 *
 * **1レスポンスに上限のあるホストでも動くよう、常に分けて取る**(Vercelのサーバーレス
 * 関数は4.5MBを超えるとエラーになる)。この取得は種別によっては数万件・十数MBになる
 * (御朱印は約5万件)ので、1回で取る作りだと載せるホストによって動いたり動かなかったり
 * する。**ホストごとの設定にせず常にこの値で分ける** —— 設定にすると、入れ忘れた環境で
 * だけ大きい種別が落ちるという踏みにくいバグになる。
 *
 * 1行は説明文込みで最大1.5KB程度なので2000件で約3MB。**上限ぎりぎりを狙わない**
 * (説明文の長い種別を足したときに、その種別だけ落ちるため)。
 */
const SPOT_DOWNLOAD_CHUNK = 2000;

const SAVE_ERROR =
  "スポットデータの保存に失敗しました。次に開いたときは再ダウンロードが必要です。";
const DELETE_ERROR = "スポットデータの削除に失敗しました。";

export interface DownloadProgress {
  loadedCount: number;
  /** 全体の件数(取得に失敗した場合のみnull=割合を出さない) */
  totalCount: number | null;
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

/** aとbのうち新しい方のISO日時を返す(null・不正値は無視する) */
function laterOf(a: string | null, b: string | null | undefined): string | null {
  const aTime = a ? Date.parse(a) : NaN;
  const bTime = b ? Date.parse(b) : NaN;
  if (Number.isNaN(bTime)) return Number.isNaN(aTime) ? null : a;
  if (Number.isNaN(aTime)) return b ?? null;
  return aTime >= bTime ? a : (b ?? null);
}

/**
 * ダウンロードしたデータの中で最も新しいupdated_atを求める(鮮度チェック用に保存する)。
 * 旧バージョンのキャッシュから来たルートはupdated_atを持たないことがあるため無視する
 */
function latestUpdatedAtOf(spots: Spot[], routes: SpotRoute[]): string | null {
  let latest: string | null = null;
  for (const s of spots) latest = laterOf(latest, s.updated_at);
  for (const r of routes) latest = laterOf(latest, r.updated_at);
  return latest;
}

/** ダウンロードした公開スポット・公開ルートをキャッシュの保存用エントリにまとめる */
function toStored(spots: Spot[], routes: SpotRoute[]): StoredSpotCache {
  return {
    downloadedAt: new Date().toISOString(),
    latestUpdatedAt: latestUpdatedAtOf(spots, routes),
    spots: spots.map(trimSpot),
    routes,
  };
}

/** 保存用エントリをアプリ内表示用(Spot[])のエントリに戻す */
function toEntry(stored: StoredSpotCache): SpotCacheEntry {
  return {
    downloadedAt: stored.downloadedAt,
    latestUpdatedAt: stored.latestUpdatedAt ?? null,
    spots: stored.spots.map(expandSpot),
    routes: stored.routes ?? [],
  };
}

/**
 * 公開スポットの件数だけを軽く取る(鮮度チェックと同じエンドポイント)。
 * ダウンロード前の確認ダイアログと、進捗の分母に使う。取れなければnull
 * (確認は省いてそのまま取りに行き、進捗は割合を出さずに件数だけ出す)。
 */
async function fetchPublishedSpotCount(typeKey: string): Promise<number | null> {
  try {
    const qs = new URLSearchParams({ type: typeKey });
    const res = await fetch(`/api/spots/last-updated?${qs.toString()}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { spotCount?: number } };
    return typeof body.data?.spotCount === "number" ? body.data.spotCount : null;
  } catch {
    return null;
  }
}

/**
 * 公開スポットを`limit`/`offset`でSPOT_DOWNLOAD_CHUNK件ずつ取り、1つの配列にまとめる。
 * 進捗は受信済みの件数で出す(バイト数ではない —— 分けて取る以上、全体のバイト数は
 * 最後まで読まないと分からないため。件数なら分母を先に1回で聞ける)。
 * 失敗時はthrowする(中断によるthrowをエラー扱いにするかは呼び出し側がsignal.abortedで判断する)
 */
async function fetchPublishedSpots(
  typeKey: string,
  controller: AbortController,
  totalCount: number | null,
  onProgress: (p: DownloadProgress) => void
): Promise<Spot[]> {
  const all: Spot[] = [];
  onProgress({ loadedCount: 0, totalCount });
  for (let offset = 0; ; offset += SPOT_DOWNLOAD_CHUNK) {
    const qs = new URLSearchParams({
      status: "published",
      type: typeKey,
      limit: String(SPOT_DOWNLOAD_CHUNK),
      offset: String(offset),
    });
    const res = await fetch(`/api/spots?${qs.toString()}`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.error ?? res.statusText);
    }
    const chunk = (await res.json()).data as Spot[] | undefined;
    if (!chunk) throw new Error("取得に失敗しました");
    all.push(...chunk);
    onProgress({ loadedCount: all.length, totalCount });
    // 返った件数がlimit未満なら最後のチャンク(ちょうど割り切れる場合は
    // 次が0件で返って終わる)
    if (chunk.length < SPOT_DOWNLOAD_CHUNK) return all;
  }
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
    const totalCount = await fetchPublishedSpotCount(typeKey);
    spots = await fetchPublishedSpots(typeKey, controller, totalCount, onProgress);
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
 * (/[type]/map・/[type]/spots で共通利用)。
 *
 * autoPromptがtrue(地図)の場合、ページを開いたタイミングで一度だけ、
 * 未ダウンロードならダウンロード確認ダイアログを出し、ダウンロード済みなら
 * サーバー側の公開スポット・公開ルートに更新が入っていないかを裏で確認して
 * (/api/spots/last-updated)、キャッシュが古ければ再ダウンロードを促すダイアログを出す。
 * スポット一覧(/[type]/spots)はautoPrompt: falseで呼び、どちらのダイアログも出さない
 * (ダウンロードは地図側から行う)。
 *
 * 数万件規模の種別でも保存できるよう、保存先はlocalStorage(約5MB上限)
 * ではなくIndexedDBを使い、かつ地図・一覧で使うフィールドだけに間引いて保存する
 * (lib/spotCacheDb.ts)。
 */
export function useSpotCache(
  typeKey: string,
  { autoPrompt = true }: { autoPrompt?: boolean } = {}
) {
  const [entry, setEntry] = useState<SpotCacheEntry | null>(null);
  const [ready, setReady] = useState(false);
  const [downloadPrompt, setDownloadPrompt] =
    useState<SpotDownloadPromptReason | null>(null);
  // ダウンロード本体を取りに行く前に、件数が分かった時点で見せる確認ダイアログ
  const [manualConfirm, setManualConfirm] = useState<{ spotCount: number } | null>(
    null
  );
  // 手動ダウンロードの件数確認中(まだ本体は取っていない)。この間はまだ
  // downloading=falseなので、全画面の進捗ダイアログは出さずボタン側だけ待機表示にする
  const [checkingSize, setCheckingSize] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoPromptedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  // manualConfirm表示中、確認ダイアログに出している件数(同意されたら進捗の分母に使う)
  const pendingCountRef = useRef<number | null>(null);

  // アンマウント時(ダイアログごと画面が消えるページ遷移等)は進行中・保留中の
  // ダウンロードを打ち切る
  useEffect(
    () => () => {
      abortRef.current?.abort();
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
    if (!ready || autoPromptedRef.current || !autoPrompt) return;
    autoPromptedRef.current = true;
    if (!entry) {
      setDownloadPrompt("missing");
      return;
    }
    // ダウンロード済みでも、公開スポット・公開ルートに更新が入っていないかを裏で確認し、
    // キャッシュが古ければ未ダウンロード時と同じ形の確認ダイアログを出す。
    // api-clientのGETキャッシュに乗ると次回以降このタブで再チェックされなくなるため素のfetch。
    // 確認の失敗(オフライン等)は黙って無視し、キャッシュのまま使い続ける
    let cancelled = false;
    (async () => {
      try {
        const qs = new URLSearchParams({ type: typeKey });
        const res = await fetch(`/api/spots/last-updated?${qs.toString()}`);
        if (!res.ok) return;
        const body = (await res.json()) as {
          data?: { latest: string | null; spotCount: number; routeCount: number };
        };
        const remote = body.data;
        if (!remote || cancelled) return;
        // 件数の違いは削除(max(updated_at)が進まない)を拾うため。日時の比較は
        // 端末の時計とずれないよう、原則ダウンロード時に保存したサーバー日時
        // (latestUpdatedAt)と比べる(持たない旧エントリのみdownloadedAtで近似)
        const cachedLatest = entry.latestUpdatedAt ?? entry.downloadedAt;
        const stale =
          remote.spotCount !== entry.spots.length ||
          remote.routeCount !== entry.routes.length ||
          (remote.latest != null &&
            Date.parse(remote.latest) > Date.parse(cachedLatest));
        if (stale) setDownloadPrompt("stale");
      } catch {
        // オフライン等。エラー表示もしない(キャッシュでの閲覧は続けられる)
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, entry, autoPrompt, typeKey]);

  /** ダウンロード済みデータを保存する。保存に失敗してもこのセッションの表示は続けられる */
  const persist = useCallback(
    (stored: StoredSpotCache) => {
      writeSpotCacheDb(typeKey, stored).catch(() => setError(SAVE_ERROR));
    },
    [typeKey]
  );

  /**
   * 公開スポットを分割取得する(進捗ダイアログにその都度件数を出す)。
   * キャンセル時はエラー扱いにせずnullを返す。`totalCount`は進捗の分母で、
   * 確認ダイアログで既に件数を聞いてある場合はその値を渡して二度聞きを避ける。
   */
  const download = useCallback(
    async (totalCount: number | null): Promise<Spot[] | null> => {
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setDownloading(true);
      try {
        const total = totalCount ?? (await fetchPublishedSpotCount(typeKey));
        return await fetchPublishedSpots(typeKey, controller, total, setProgress);
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
    [typeKey]
  );

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

  /** ダウンロードした結果をキャッシュへ反映する(3つの入口で共通) */
  const store = useCallback(
    async (spots: Spot[]) => {
      const stored = toStored(spots, await fetchPublicRoutes());
      setEntry(toEntry(stored));
      persist(stored);
    },
    [persist, fetchPublicRoutes]
  );

  /**
   * 歯車メニューの「ダウンロード」ボタン: まず件数だけを軽く聞き、それを見せてから
   * 取りに行く(数万件になる種別があるため、通信量の見当が付かないまま始めない)。
   * 件数が取れなかったときは確認を省いてそのままダウンロードする —— 取り終わってから
   * 「ダウンロードしますか?」と聞いても意味がないため。
   */
  const startManualDownload = useCallback(async () => {
    setCheckingSize(true);
    const spotCount = await fetchPublishedSpotCount(typeKey);
    setCheckingSize(false);
    if (spotCount !== null) {
      pendingCountRef.current = spotCount;
      setManualConfirm({ spotCount });
      return;
    }
    const data = await download(null);
    if (data) await store(data);
  }, [typeKey, download, store]);

  const confirmManualDownload = useCallback(async () => {
    const pendingCount = pendingCountRef.current;
    pendingCountRef.current = null;
    setManualConfirm(null);
    const data = await download(pendingCount);
    if (data) await store(data);
  }, [download, store]);

  const cancelManualDownload = useCallback(() => {
    pendingCountRef.current = null;
    setManualConfirm(null);
  }, []);

  /** 「未ダウンロードです」「更新があります」ダイアログで同意したとき(どちらも全件を取り直す) */
  const confirmDownloadPrompt = useCallback(async () => {
    const reason = downloadPrompt;
    setDownloadPrompt(null);
    const data = await download(null);
    if (!data) {
      // 失敗・キャンセル時は確認ダイアログに戻す(エラーはそのダイアログ内に表示される)
      setDownloadPrompt(reason);
      return;
    }
    await store(data);
  }, [downloadPrompt, download, store]);

  const dismissDownloadPrompt = useCallback(() => setDownloadPrompt(null), []);

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
        // この変更でサーバー側のupdated_atも進んでいるため、キャッシュ側の
        // 鮮度基準も進めておく(次の鮮度チェックが自分の変更を「更新あり」と
        // 誤検知しないように)
        const next = {
          ...prev,
          spots,
          latestUpdatedAt: laterOf(prev.latestUpdatedAt, spot.updated_at),
        };
        persist({
          downloadedAt: next.downloadedAt,
          latestUpdatedAt: next.latestUpdatedAt,
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
          latestUpdatedAt: next.latestUpdatedAt,
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
    downloadPrompt,
    manualConfirm,
    startManualDownload,
    cancelDownload,
    confirmManualDownload,
    cancelManualDownload,
    confirmDownloadPrompt,
    dismissDownloadPrompt,
    clearCache,
    applySpotChange,
    applySpotDelete,
  };
}

export type SpotCache = ReturnType<typeof useSpotCache>;
