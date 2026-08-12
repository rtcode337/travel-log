/**
 * 訪問記録の写真まわりの共通処理(VisitFormModal・AddSpotModalの探訪追加で共用)。
 * 写真は保存前にcanvasで長辺MAX_PHOTO_SIZEに縮小・JPEG圧縮してからdata URLにする。
 */

export const MAX_PHOTO_SIZE = 1280;

/** 1件の訪問記録に付けられる写真の枚数(サーバー側の上限と合わせる) */
export const MAX_PHOTOS_PER_VISIT = 10;

/**
 * 1リクエストで送れる本文の上限(バイト)。未設定なら制限なし。
 *
 * 訪問記録は写真をdata URLのままJSONに載せて1回のPOSTで送るため、**ホスト側に
 * リクエストボディの上限があると、枚数を入れたときだけ413で弾かれる**
 * (Vercelのサーバーレス関数は4.5MB)。上限のあるホストではこの値を設定し、
 * 1枚あたりの目安(=上限÷最大枚数)に収まるまで画質を落として書き出す。
 *
 * Docker運用のように上限が無いホストでは未設定のままでよく、その場合は
 * 従来どおり画質0.8の1回書き出しになる(挙動は変わらない)。
 */
const MAX_UPLOAD_BYTES = Number(process.env.NEXT_PUBLIC_MAX_UPLOAD_BYTES) || 0;

/** data URLの実バイト数(Base64は3バイトを4文字で表す) */
function dataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * 1枚あたりの目安バイト数。上限を最大枚数で割る(JSONの他の項目ぶんは1割見る)。
 * 何枚付けるかは書き出す時点では決まらないので、**常に最大枚数で割る** ——
 * 少なく見積もると、あとから足したときに全体が上限を超える。
 */
const PHOTO_BUDGET_BYTES = MAX_UPLOAD_BYTES
  ? Math.floor((MAX_UPLOAD_BYTES * 0.9) / MAX_PHOTOS_PER_VISIT)
  : 0;

/** 目安に収まるまで順に試す品質。最後まで収まらなければ一番低い品質で出す */
const JPEG_QUALITIES = [0.8, 0.7, 0.6, 0.5, 0.4];

/** Dateをdatetime-localのvalue(ローカル時刻の`YYYY-MM-DDTHH:mm`)にする */
export function toDateTimeLocalValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

/** 画像ファイルを長辺MAX_PHOTO_SIZEに縮小し、JPEGのdata URLにする */
export function resizeImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("画像を読み込めませんでした"));
      img.onload = () => {
        const scale = Math.min(1, MAX_PHOTO_SIZE / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas is not supported"));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        // 上限のあるホストでは目安に収まる品質を探す(未設定なら従来どおり0.8で1回)
        let dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITIES[0]);
        if (PHOTO_BUDGET_BYTES) {
          for (const quality of JPEG_QUALITIES.slice(1)) {
            if (dataUrlBytes(dataUrl) <= PHOTO_BUDGET_BYTES) break;
            dataUrl = canvas.toDataURL("image/jpeg", quality);
          }
        }
        resolve(dataUrl);
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
