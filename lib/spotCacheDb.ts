"use client";

import type { Spot, SpotRoute } from "@/lib/types";

/**
 * 公開スポットのキャッシュに保存するのは、地図のピン・一覧・絞り込み・重複チェックが
 * 実際に読むフィールドだけに絞る。詳細(description など)はスポットを
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
  | "lat"
  | "lng"
  | "region"
  | "rank"
  | "series"
  | "categories"
  | "status"
>;

export interface StoredSpotCache {
  downloadedAt: string; // ISO
  /**
   * ダウンロードしたデータ(公開スポット・公開ルート)の中で最も新しいupdated_at。
   * 鮮度チェック(/api/spots/last-updated との比較)は端末の時計に依らないよう
   * downloadedAt(端末時刻)ではなくこちら(サーバー時刻)で行う。
   * この項目を持たない旧エントリはdownloadedAtへフォールバックする(任意項目のため
   * DB_VERSIONは上げない)
   */
  latestUpdatedAt?: string | null;
  spots: CachedSpot[];
  /**
   * 公開(published)ルート。公開スポットのダウンロードと同時に取得して一緒に保存する
   * (地図のルート表示・別種別の重ね表示がAPIに戻らず使えるように)。件数が少なく
   * 経由地込みでも小さいため、スポットのような間引きはしない
   */
  routes: SpotRoute[];
}

/** アプリ内のSpotから、キャッシュに保存する分だけを抜き出す */
export function trimSpot(spot: Spot): CachedSpot {
  return {
    id: spot.id,
    name: spot.name,
    name_kana: spot.name_kana,
    lat: spot.lat,
    lng: spot.lng,
    region: spot.region,
    rank: spot.rank,
    series: spot.series,
    categories: spot.categories,
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
    // key(CSV等からの参照キー)とorigin(登録経路)は管理画面のインポート・
    // 還元用エクスポートだけが読み、そちらはキャッシュではなくAPIから全件
    // 取り直すため、キャッシュには持たせない
    key: null,
    origin: "csv",
    description: null,
    created_by: null,
    created_at: "",
    updated_at: "",
  };
}

const DB_NAME = "travel-log";
// 検証中に一時的にストア名を"public-spots-v2"へ切り替える版(DB_VERSION=2)を
// 配ってしまったことがあるため、それを開いたブラウザより確実に前進するよう3にした
// (IndexedDBはバージョンを後退できず、既存より低いバージョンでopenすると失敗する)。
// 4はCachedSpotの形が変わった(prefecture/municipality → region)ためのもので、
// 旧形式のまま残っているエントリを読ませないようupgrade時にストアごと作り直す。
// 5も同じくCachedSpotの形が変わったため(rank → series、category → categories。
// 特にcategoriesは配列前提で読むため、旧形式が残ると絞り込みで落ちる)。
// 6はエントリにroutes(公開ルート)が加わったため(旧エントリのままだと
// 再ダウンロードするまでルートが表示されなくなるので、ストアごと作り直して
// ダウンロードし直させる)。
// 7はCachedSpotにrank(ピンの色・大きさを決める段階)が加わったため
// (旧エントリのままだと、ランクを使う種別のピンが全部「ランクなし」の白になる)。
const DB_VERSION = 7;
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
      // 旧バージョンのエントリはCachedSpotの形が違うので中身ごと捨てる
      // (次回アクセス時に /api/spots から取り直される)
      if (db.objectStoreNames.contains(STORE)) {
        db.deleteObjectStore(STORE);
      }
      // keyPathは持たせず、typeKeyを外部キーにしてput/getする
      db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function readSpotCacheDb(
  typeKey: string
): Promise<StoredSpotCache | null> {
  if (!idbAvailable()) return null;
  clearLegacyCache(typeKey);
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

export async function deleteSpotCacheDb(typeKey: string): Promise<void> {
  if (!idbAvailable()) return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(typeKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/**
 * 旧localStorage方式(種別ごとに1つのJSON文字列)のキャッシュを掃除する。
 * 中身はprefecture/municipality時代の形なので引き継がず、キーを消すだけにして
 * /api/spots から取り直させる。
 */
function clearLegacyCache(typeKey: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(LEGACY_PREFIX + typeKey);
  } catch {
    // 掃除に失敗しても実害はないので無視する
  }
}
