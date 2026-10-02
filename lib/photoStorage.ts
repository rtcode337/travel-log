import { promises as fs } from "fs";
import path from "path";

/**
 * 訪問記録の写真の保存先(サーバー専用モジュール)。
 *
 * 保存先は環境変数`PHOTO_STORAGE`で切り替える。
 *   - `fs`(既定) … ローカルのファイルシステム。docker-composeはデータの置き場(data/)を
 *     /data にbindマウントし、PHOTOS_DIR=/data/photos を渡す。Docker運用はこちら。
 *   - `supabase` … Supabase Storage。永続ディスクを持てない/持ちたくないホスト
 *     (Vercel等のサーバーレスや、ボリューム無しのコンテナホスト)向け。
 *
 * Supabase StorageはRESTが素直なので、SDK(@supabase/supabase-js や AWS SDK)を
 * 足さず素の`fetch`だけで実装している(このリポジトリの「依存を増やさない」方針。
 * S3/R2直だとSigV4署名が要るため、まずはSupabase Storageのみ対応)。
 *
 * 写真は非公開のため、どの保存先でも公開URLは使わず、認証付きの配信ルート
 * (app/api/photos/[...path]/route.ts)からこのモジュール経由で読み出して返す。
 */

export interface PhotoStorage {
  /** 相対パスに保存する(既存があれば上書き) */
  put(relPath: string, data: Uint8Array<ArrayBuffer>, contentType: string): Promise<void>;
  /** 相対パスの中身を読む。存在しない・読めない場合はnull */
  get(relPath: string): Promise<Uint8Array<ArrayBuffer> | null>;
  /** 相対パスを削除する。存在しなくてもエラーにしない */
  delete(relPath: string): Promise<void>;
  /**
   * 前置き(`<ユーザーID>/`)の下にある写真の合計バイト数と枚数。ユーザーごとの
   * 容量の上限と使用量の表示に使う。DBに数を持たず実物を数えるので、ずれない
   */
  usage(prefix: string): Promise<PhotoUsage>;
}

export interface PhotoUsage {
  bytes: number;
  count: number;
}

/** `fs`バックエンドの保存先ディレクトリ(既定はcwd直下のphotos)。使うたびに環境変数から読む */
const photosDir = () => process.env.PHOTOS_DIR ?? path.join(process.cwd(), "photos");

const fsStorage: PhotoStorage = {
  async put(relPath, data) {
    const absPath = path.join(photosDir(), relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, data);
  },
  async get(relPath) {
    try {
      return Uint8Array.from(await fs.readFile(path.join(photosDir(), relPath)));
    } catch {
      return null;
    }
  },
  async delete(relPath) {
    // 既に無いファイルは無視する(訪問記録の削除自体は妨げない)
    await fs.unlink(path.join(photosDir(), relPath)).catch(() => {});
  },
  async usage(prefix) {
    const total: PhotoUsage = { bytes: 0, count: 0 };
    const walk = async (dir: string) => {
      let entries: import("fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return; // まだ1枚も無い(ディレクトリが無い)
      }
      for (const entry of entries) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(p);
        else if (entry.isFile()) {
          total.bytes += (await fs.stat(p)).size;
          total.count++;
        }
      }
    };
    await walk(path.join(photosDir(), prefix));
    return total;
  },
};

/**
 * Supabase Storageの接続情報。未設定のまま使おうとした場合は起動時ではなく利用時に落とす。
 *
 * **キーの渡し方が世代で違う**ので、ここで一度だけ組み立てて使い回す。
 *
 * - **新しいキー(`sb_secret_...`)は`apikey`ヘッダだけ**に載せる。公式の移行ガイドいわく
 *   「If you also pass the key on the `Authorization: Bearer` header, which many Supabase
 *   clients do by default, the platform tries to parse it as a JWT and rejects the request
 *   with `Invalid JWT`」——**JWTではないので、Bearerに載せると弾かれる**
 * - **レガシーの`service_role`はJWT**なので、従来どおり`Authorization: Bearer`にも載せる
 *   (supabase-jsが送っているのと同じ形)
 *
 * 2026年末にレガシーキーは廃止予定で、**新規プロジェクトには`service_role`自体が無い**。
 * 環境変数は`SUPABASE_SECRET_KEY`を正とし、`SUPABASE_SERVICE_ROLE_KEY`は
 * 既存のデプロイが壊れないよう読むだけにしてある。
 */
function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "visit-photos";
  if (!url || !key) {
    throw new Error(
      "PHOTO_STORAGE=supabase には SUPABASE_URL と SUPABASE_SECRET_KEY が必要です。"
    );
  }
  // 新しいキーはapikeyのみ、レガシーのJWTは両方に載せる(上のコメント参照)
  const headers: Record<string, string> = key.startsWith("sb_")
    ? { apikey: key }
    : { apikey: key, Authorization: `Bearer ${key}` };
  return {
    objectUrl: (relPath: string) =>
      `${url.replace(/\/$/, "")}/storage/v1/object/${bucket}/${relPath}`,
    listUrl: `${url.replace(/\/$/, "")}/storage/v1/object/list/${bucket}`,
    headers,
  };
}

const supabaseStorage: PhotoStorage = {
  async put(relPath, data, contentType) {
    const { objectUrl, headers } = supabaseConfig();
    const res = await fetch(objectUrl(relPath), {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": contentType,
        // パスはUUIDなので衝突しない想定だが、再送で失敗しないよう上書き可にする
        "x-upsert": "true",
      },
      body: data,
    });
    if (!res.ok) {
      throw new Error(
        `写真のアップロードに失敗しました (${res.status} ${await res.text()})`
      );
    }
  },
  async get(relPath) {
    const { objectUrl, headers } = supabaseConfig();
    const res = await fetch(objectUrl(relPath), { headers });
    if (!res.ok) return null;
    return new Uint8Array(await res.arrayBuffer());
  },
  async delete(relPath) {
    const { objectUrl, headers } = supabaseConfig();
    // 失敗しても訪問記録の削除自体は妨げない
    await fetch(objectUrl(relPath), { method: "DELETE", headers }).catch(() => {});
  },
  async usage(prefix) {
    // 一覧APIは1階層ずつ返す(フォルダは id が null)ので、<年>/<月>/ と降りていく
    const { listUrl, headers } = supabaseConfig();
    const total: PhotoUsage = { bytes: 0, count: 0 };
    const walk = async (dir: string) => {
      for (let offset = 0; ; offset += 1000) {
        const res = await fetch(listUrl, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ prefix: dir, limit: 1000, offset }),
        });
        if (!res.ok) throw new Error(`写真の一覧を取得できませんでした (${res.status})`);
        const items = (await res.json()) as {
          name: string;
          id: string | null;
          metadata?: { size?: number } | null;
        }[];
        for (const item of items) {
          if (item.id === null) await walk(`${dir}/${item.name}`);
          else {
            total.bytes += item.metadata?.size ?? 0;
            total.count++;
          }
        }
        if (items.length < 1000) return;
      }
    };
    // supabase-js と同じく、フォルダは末尾の / を付けずに渡す
    await walk(prefix.replace(/\/+$/, ""));
    return total;
  },
};

export const photoStorage: PhotoStorage =
  process.env.PHOTO_STORAGE === "supabase" ? supabaseStorage : fsStorage;
