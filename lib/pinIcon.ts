import type * as maplibregl from "maplibre-gl";
import {
  PIN_PATH_VIEW_HEIGHT,
  PIN_PATH_VIEW_WIDTH,
  type PinShapeSpec,
} from "./pinShape";
import { spotMarkKey, type SpotFace, type SpotMark } from "./spotStyle";

/**
 * 地図ピン(下がとんがった吹き出し型)の画像をcanvasで生成し、
 * MapLibreのスタイル画像として登録する。とんがりの先端が画像の下端中央に
 * 来るように描くので、symbolレイヤー側は `icon-anchor: "bottom"` で使う。
 * 縁取り線は常に描き、非公開スポットだけ破線にする。
 *
 * **何を描くかは決めない。** 面(色・大きさ)・形・中身は`lib/spotStyle.ts`が
 * ランクとシリーズから解決したものを受け取るだけ —— 地図とバッジで判断が
 * 食い違わないようにするため。
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

/** FNV-1a。長い値(画像のbase64・自前のパス)をIDに入れず固定長にするために使う */
function fnv1a(raw: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < raw.length; i += 1) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * ピン画像のID。**見た目そのものを混ぜる** —— `ensurePinImage`は
 * `map.hasImage(id)`で早期returnするので、面・形・中身のどれかがIDに入って
 * いないと、設定を変えても古い画像が使われ続ける。種別の設定は
 * `/api/spot-types`の取得完了までは既定値なので、名前だけをIDにすると
 * 暫定の見た目のまま固まってしまう。
 */
export function pinIconId(
  face: SpotFace,
  mark: SpotMark,
  shape: PinShapeSpec,
  visited: boolean,
  isPrivate: boolean
): string {
  const base = `pin-${visited ? "visited" : "normal"}${isPrivate ? "-private" : ""}`;
  const faceKey = fnv1a(
    `${face.color}|${face.borderColor}|${face.size}|${face.textColor}`
  );
  // 自前のパス・画像はそのまま混ぜるとIDが長くなるうえ、MapLibreの画像IDに使えない
  // 文字が入りうるのでハッシュにする
  const shapeKey = typeof shape === "string" ? shape : `p${fnv1a(shape.path)}`;
  return `${base}-${faceKey}-${shapeKey}-m${fnv1a(spotMarkKey(mark))}`;
}

/** data URL画像をHTMLImageElementとして読み込む(base64は同期的に近いが、確実性のためdecode()を待つ) */
async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/** ピン画像を(未登録なら)生成して登録し、そのIDを返す。冪等。中身が画像の場合は非同期で読み込む */
export async function ensurePinImage(
  map: maplibregl.Map,
  /** 面(色・大きさ)。lib/spotStyle.ts の resolveSpotFace で解決したもの */
  face: SpotFace,
  /** 中に描く印。同じく resolveSpotMark で解決したもの */
  mark: SpotMark,
  /** 頭の形。同じく resolveSpotShape で解決したもの */
  shape: PinShapeSpec,
  visited: boolean,
  /** 自分だけの非公開スポット。公開スポットと見分けられるよう破線で縁取る */
  isPrivate: boolean
): Promise<string> {
  const id = pinIconId(face, mark, shape, visited, isPrivate);
  if (map.hasImage(id)) return id;

  // 訪問済みは(ランク・シリーズの色より視認性を優先し)ピン全体を緑+チェックマークにする
  const fill = visited ? "#16a34a" : face.color;
  const borderColor = visited ? "#15803d" : face.borderColor;
  const textColor = visited ? "#ffffff" : face.textColor;

  const size = face.size;
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

  // 頭ととんがりを1つのパスとして描く(塗りと縁取りを一度に済ませるため)。
  // 自前のパス(設定ファイル由来)も同じ1本として扱えるようPath2Dに組む
  const path = new Path2D();
  if (typeof shape !== "string") {
    // 100×145の箱に描かれたパスを、このピンの寸法へ拡大縮小して取り込む。
    // 箱の下端中央がスポットの位置(icon-anchor: bottom)に来る
    const sx = size / PIN_PATH_VIEW_WIDTH;
    const sy = (size + tail) / PIN_PATH_VIEW_HEIGHT;
    path.addPath(new Path2D(shape.path), {
      a: sx,
      b: 0,
      c: 0,
      d: sy,
      e: PIN_ICON_PAD,
      f: PIN_ICON_PAD,
    });
  } else if (shape === "rounded-square") {
    // 角丸四角。円と同じ幅に収め、下辺の左右から先端へ引く。
    // 下辺は角丸の分だけ内側から始まるので、とんがりの付け根も同じ位置に合わせる
    const k = r * 0.42; // 角丸の半径
    const left = cx - r;
    const right = cx + r;
    const top = cy - r;
    const bottom = cy + r;
    path.moveTo(left + k, top);
    path.lineTo(right - k, top);
    path.quadraticCurveTo(right, top, right, top + k);
    path.lineTo(right, bottom - k);
    path.quadraticCurveTo(right, bottom, right - k, bottom);
    path.lineTo(cx, tipY); // 右下の角からとんがりの先端へ
    path.lineTo(left + k, bottom);
    path.quadraticCurveTo(left, bottom, left, bottom - k);
    path.lineTo(left, top + k);
    path.quadraticCurveTo(left, top, left + k, top);
  } else if (shape === "castle") {
    // 上辺を凸凹(狭間)にした四角。城郭の胸壁の記号。多角形より輪郭の特徴が
    // 分かりやすく、小さいピンでも「他と違う」ことは読み取れる
    const left = cx - r;
    const right = cx + r;
    const top = cy - r;
    const bottom = cy + r;
    const step = (2 * r) / 5; // 凸凹の1区画。凸3・凹2で上辺を作る
    const notch = r * 0.35; // 凹みの深さ
    path.moveTo(left, bottom);
    path.lineTo(left, top);
    for (let i = 0; i < 5; i++) {
      const y = i % 2 === 0 ? top : top + notch;
      path.lineTo(left + i * step, y);
      path.lineTo(left + (i + 1) * step, y);
    }
    path.lineTo(right, bottom);
    path.lineTo(cx, tipY); // 右下の角から先端へ
  } else if (shape !== "circle") {
    // 多角形。**真下に頂点が来る向きは使わない** —— とんがりと重なって
    // 長さ0の線分になり、輪郭が潰れるため。下側の2頂点から先端へ引く
    const deg = (d: number): [number, number] => {
      const rad = (d * Math.PI) / 180;
      return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
    };
    // 頂点を時計回りに並べ、下側の2頂点の間に先端を挟む。
    // bottomRightはその「右下の頂点」の添字(ここを過ぎたら先端へ引く)
    const [angles, bottomRight] =
      shape === "diamond"
        ? [[-90, 0, 180], 1] // ひし形は左右の頂点が下側の2点を兼ねる
        : shape === "pentagon"
          ? [[-90, -18, 54, 126, 198], 2]
          : [[-60, 0, 60, 120, 180, 240], 2]; // 六角形は上辺を平らにする
    (angles as number[]).forEach((d, i) => {
      const [x, y] = deg(d);
      if (i === 0) path.moveTo(x, y);
      else path.lineTo(x, y);
      if (i === bottomRight) path.lineTo(cx, tipY); // 右下の頂点から先端へ
    });
  } else {
    // 円の下側±45°の2点からとんがりの先端へ直線を引いた吹き出し型
    path.arc(cx, cy, r, (3 * Math.PI) / 4, Math.PI / 4);
    path.lineTo(cx, tipY);
  }
  path.closePath();
  // shadow系プロパティはscale()の影響を受けないため実ピクセルで指定する
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 2 * PIXEL_RATIO;
  ctx.shadowOffsetY = 1 * PIXEL_RATIO;
  ctx.fillStyle = fill;
  ctx.fill(path);
  ctx.shadowColor = "transparent";

  // 縁取りは常に描く。非公開だけ破線にする(それ以外はシリーズの見た目のまま)
  ctx.setLineDash(isPrivate ? [3, 2.5] : []);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = borderColor;
  ctx.stroke(path);
  ctx.setLineDash([]);

  // 中身。訪問済みのときは印より「訪問済みかどうか」を優先して✓を描く
  const drawn: SpotMark = visited ? { kind: "text", text: "✓" } : mark;
  if (drawn.kind === "icon") {
    // アイコンは中央へ。塗りは文字色と同じ = ピンの色に対して読める色なので、
    // 穴や隙間があってもピンの色が透けて見えるだけで問題ない
    const iconSize = size * 0.62;
    const scale = iconSize / drawn.icon.viewSize;
    const placed = new Path2D();
    placed.addPath(new Path2D(drawn.icon.path), {
      a: scale,
      b: 0,
      c: 0,
      d: scale,
      e: cx - iconSize / 2,
      f: cy - iconSize / 2,
    });
    ctx.fillStyle = textColor;
    ctx.fill(placed);
  } else if (drawn.kind === "image") {
    try {
      const img = await loadImage(drawn.src);
      const imgSize = size * 0.7;
      ctx.drawImage(img, cx - imgSize / 2, cy - imgSize / 2, imgSize, imgSize);
    } catch {
      // 画像の読み込みに失敗した場合はラベル無しのまま(ピン自体は表示する)
    }
  } else if (drawn.kind === "text") {
    // シリーズもカテゴリの文字も自由入力で複数文字もありうるので、
    // その場合は少し小さくして収める
    const text = drawn.text;
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
