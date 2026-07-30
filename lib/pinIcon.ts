import type * as maplibregl from "maplibre-gl";
import type { Series } from "./types";
import { autoTextColor, findSeriesStyle, isImageLabel, type SeriesStyleDefinition } from "./seriesStyle";

/**
 * 地図ピン(下が三角にとんがった吹き出し型)の画像をcanvasで生成し、
 * MapLibreのスタイル画像として登録する。とんがりの先端が画像の下端中央に
 * 来るように描くので、symbolレイヤー側は `icon-anchor: "bottom"` で使う。
 * 縁取り線は常に描き、非公開スポットだけ破線にする(色・大きさ・ラベルは
 * シリーズのまま変えない)。
 */

const PIXEL_RATIO = 2;
/**
 * 影のにじみが切れないよう画像の周囲に取る余白(CSS px)。
 * この分だけとんがりの先端が画像下端から浮くので、symbolレイヤー側は
 * `icon-offset: [0, PIN_ICON_PAD]` で押し下げて先端を座標に合わせる
 */
export const PIN_ICON_PAD = 3;

/** とんがり部分の高さ(頭の円のサイズに比例、最低5px) */
function pinTailHeight(size: number): number {
  return Math.max(5, Math.round(size * 0.45));
}

/**
 * 見た目そのものを短いハッシュにした値。画像IDに混ぜることで、同じシリーズでも
 * 見た目が変われば別の画像IDになる(=作り直される)ようにする。
 * seriesStylesは`/api/spot-types`の取得完了まで暫定でDEFAULT_SERIES_STYLESになるため、
 * シリーズ名だけをIDにすると暫定の見た目で登録した画像がそのまま使われ続けてしまう
 * (ensurePinImageはmap.hasImage()で早期returnする)。
 */
function styleSignature(style: SeriesStyleDefinition): string {
  const label = isImageLabel(style.label) ? `img:${style.label.image}` : `txt:${style.label}`;
  const raw = `${style.color}|${style.borderColor}|${style.size}|${style.textColor ?? ""}|${label}`;
  // FNV-1a(ラベルが画像(base64)のこともあるため、IDに全文を入れず固定長にする)
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function pinIconId(
  series: Series | null,
  visited: boolean,
  isPrivate: boolean,
  seriesStyles: SeriesStyleDefinition[]
): string {
  const sig = styleSignature(findSeriesStyle(series, seriesStyles));
  return `pin-${visited ? "visited" : "normal"}${isPrivate ? "-private" : ""}-${sig}-${series ?? "__null__"}`;
}

/** data URL画像をHTMLImageElementとして読み込む(base64は同期的に近いが、確実性のためdecode()を待つ) */
async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/** ピン画像を(未登録なら)生成して登録し、そのIDを返す。冪等。ラベルが画像の場合は非同期で読み込む */
export async function ensurePinImage(
  map: maplibregl.Map,
  series: Series | null,
  visited: boolean,
  /** 自分だけの非公開スポット。公開スポットと見分けられるよう破線で縁取る */
  isPrivate: boolean,
  seriesStyles: SeriesStyleDefinition[]
): Promise<string> {
  const id = pinIconId(series, visited, isPrivate, seriesStyles);
  if (map.hasImage(id)) return id;

  const style = findSeriesStyle(series, seriesStyles);
  // 訪問済みは(シリーズの色より視認性を優先し)ピン全体を緑+チェックマークにする
  const fill = visited ? "#16a34a" : style.color;
  const borderColor = visited ? "#15803d" : style.borderColor;
  const label = visited ? "✓" : style.label;
  const textColor = visited ? "#ffffff" : style.textColor ?? autoTextColor(style.color);

  const size = style.size;
  const tail = pinTailHeight(size);
  const w = size + PIN_ICON_PAD * 2;
  const h = size + tail + PIN_ICON_PAD * 2;
  const canvas = document.createElement("canvas");
  canvas.width = w * PIXEL_RATIO;
  canvas.height = h * PIXEL_RATIO;
  const ctx = canvas.getContext("2d");
  if (!ctx) return id;
  ctx.scale(PIXEL_RATIO, PIXEL_RATIO);

  const r = size / 2;
  const cx = w / 2;
  const cy = PIN_ICON_PAD + r; // 頭(円)の中心
  const tipY = h - PIN_ICON_PAD; // とんがりの先端(画像下端中央)

  // 円の下側±45°の2点からとんがりの先端へ直線を引いた吹き出し型
  ctx.beginPath();
  ctx.arc(cx, cy, r, (3 * Math.PI) / 4, Math.PI / 4);
  ctx.lineTo(cx, tipY);
  ctx.closePath();
  // shadow系プロパティはscale()の影響を受けないため実ピクセルで指定する
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 2 * PIXEL_RATIO;
  ctx.shadowOffsetY = 1 * PIXEL_RATIO;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = "transparent";

  // 縁取りは常に描く。非公開だけ破線にする(それ以外はシリーズの見た目のまま)
  ctx.setLineDash(isPrivate ? [3, 2.5] : []);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = borderColor;
  ctx.stroke();
  ctx.setLineDash([]);

  if (!visited && isImageLabel(label)) {
    try {
      const img = await loadImage(label.image);
      const imgSize = size * 0.7;
      ctx.drawImage(img, cx - imgSize / 2, cy - imgSize / 2, imgSize, imgSize);
    } catch {
      // 画像の読み込みに失敗した場合はラベル無しのまま(ピン自体は表示する)
    }
  } else {
    const text = visited ? "✓" : typeof label === "string" ? label : "";
    if (text) {
      // seriesは自由入力で複数文字もありうるので、その場合は少し小さくして収める
      const fontSize = Math.max(
        8,
        Math.round(size * (text.length > 1 ? 0.38 : 0.6))
      );
      ctx.font = `bold ${fontSize}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = textColor;
      ctx.fillText(text, cx, cy + fontSize * 0.05);
    }
  }

  // 生成に時間がかかる(画像読み込み等)間に同じidで別の呼び出しが先に登録している
  // 可能性があるため、登録直前にもう一度確認する
  if (map.hasImage(id)) return id;
  map.addImage(
    id,
    ctx.getImageData(0, 0, canvas.width, canvas.height),
    { pixelRatio: PIXEL_RATIO }
  );
  return id;
}
