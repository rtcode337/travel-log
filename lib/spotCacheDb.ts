"use client";

import type { Spot } from "@/lib/types";

/**
 * 公開スポットのキャッシュに保存するのは、地図のピン・一覧・絞り込み・重複チェックが
 * 実際に読むフィールドだけに絞る。詳細(description/official_url など)はスポットを
 * 開いたときに api.spots.get で個別に取り直すので、キャッシュには持たせない。
 * spot_type_id も種別ごとにストア上のキーを分けているため保存不要。
 * これにより数万件規模の大規模データでも保存サイズを抑えられる
 * (加えて localStorage の約5MB上限に縛られない IndexedDB を使う)。
 */
export type CachedSpot = Pick<
  Spot,
  | "id"
  | "name"
  | "name_kana"
  | "prefecture"
  | "municipality"
  | "lat"
  | "lng"
  | "rank"
  | "category"
  | "status"
>;

export interface StoredSpotCache {
  downloadedAt: string; // ISO
  spots: CachedSpot[];
}

/** アプリ内のSpotから、キャッシュに保存する分だけを抜き出す */
export function trimSpot(spot: Spot): CachedSpot {
  return {
    id: spot.id,
    name: spot.name,
    name_kana: spot.name_kana,
    prefecture: spot.prefecture,
    municipality: spot.municipality,
    lat: spot.lat,
    lng: spot.lng,
    rank: spot.rank,
    category: spot.category,
    status: spot.status,
  };
}

/**
 * キャッシュのCachedSpotを、アプリ内で扱うSpot型に戻す。保存していないフィールドは
 * 公開スポットの表示・絞り込みでは読まれない(詳細は api.spots.get で取り直す)ため、
 * 型を満たすためのプレースホルダーを入れる。
 */
export function expandSpot(spot: CachedSpot): Spot {
  return {
    ...spot,
    spot_type_id: "",
    description: null,
    official_url: null,
    source: "manual",
    created_by: null,
    created_at: "",
    updated_at: "",
  };
}

const DB_NAME = "travel-log";
// 検証中に一時的にストア名を"public-spots-v2"へ切り替える版(DB_VERSION=2)を
// 配ってしまったことがあるため、それを開いたブラウザより確実に前進するよう3にする
// (IndexedDBはバージョンを後退できず、既存より低いバージョンでopenすると失敗する)。
const DB_VERSION = 3;
const STORE = "public-spots"; // 値のキーはtypeKey
const TEMP_V2_STORE = "public-spots-v2"; // 上記の一時版が作ったストア(残っていれば削除)
const LEGACY_PREFIX = "travel-log:public-spots:"; // 旧localStorage方式のキー接頭辞

function idbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(TEMP_V2_STORE)) {
        db.deleteObjectStore(TEMP_V2_STORE);
      }
      if (!db.objectStoreNames.contains(STORE)) {
        // keyPathは持たせず、typeKeyを外部キーにしてput/getする
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readSpotCacheDb(
  typeKey: string
): Promise<StoredSpotCache | null> {
  if (!idbAvailable()) return null;
  // 旧localStorage方式のキャッシュが残っていれば、初回に一度だけIndexedDBへ引き継ぐ
  const migrated = await migrateLegacy(typeKey);
  if (migrated) return migrated;
  try {
    const db = await openDb();
    return await new Promise<StoredSpotCache | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(typeKey);
      req.onsuccess = () => resolve((req.result as StoredSpotCache) ?? null);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function writeSpotCacheDb(
  typeKey: string,
  entry: StoredSpotCache
): Promise<void> {
  if (!idbAvailable()) throw new Error("IndexedDB is not available");
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry, typeKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * 旧localStorage方式(種別ごとに1つのJSON文字列)のキャッシュをIndexedDBへ移行する。
 * 移行後は元のlocalStorageキーを削除して二度目以降は素通りさせる。
 */
async function migrateLegacy(typeKey: string): Promise<StoredSpotCache | null> {
  if (typeof localStorage === "undefined") return null;
  const key = LEGACY_PREFIX + typeKey;
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { downloadedAt?: string; spots?: Spot[] };
    if (!parsed.spots) {
      localStorage.removeItem(key);
      return null;
    }
    const entry: StoredSpotCache = {
      downloadedAt: parsed.downloadedAt ?? new Date().toISOString(),
      spots: parsed.spots.map(trimSpot),
    };
    await writeSpotCacheDb(typeKey, entry);
    localStorage.removeItem(key);
    return entry;
  } catch {
    try {
      localStorage.removeItem(key);
    } catch {
      // 破損データの掃除に失敗しても実害はないので無視する
    }
    return null;
  }
}
