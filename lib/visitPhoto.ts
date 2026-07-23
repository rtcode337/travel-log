/**
 * 訪問記録の写真まわりの共通処理(VisitFormModal・AddSpotModalの探訪追加で共用)。
 * 写真は保存前にcanvasで長辺MAX_PHOTO_SIZEに縮小・JPEG圧縮してからdata URLにする。
 */

export const MAX_PHOTO_SIZE = 1280;

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
        resolve(canvas.toDataURL("image/jpeg", 0.8));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
