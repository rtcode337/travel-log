/**
 * 地図ピンの「形」と「中に描くアイコン」の定義。**シリーズが持つ見た目の一部**で
 * (`lib/seriesStyle.ts`)、描画は`lib/pinIcon.ts`が行う。
 *
 * かつてはカテゴリごとの設定(`category_styles`)だったが、カテゴリは複数選べる=
 * 1スポットに複数の形が当たりうるため「配列順で先に一致したもの」という説明が要り、
 * しかも色(シリーズ)と形(カテゴリ)が別々の軸から来るので設定を読む側が追いにくかった。
 * **1スポットに1つのシリーズ**へ寄せたことで、見た目の出どころがランク(色・大きさ)と
 * シリーズ(形・中身)の2つだけになる。
 */

/** ピンの頭の形。増やすときはlib/pinIcon.tsの描画にも分岐を足すこと */
export const PIN_SHAPES = [
  "circle",
  "rounded-square",
  "diamond",
  "pentagon",
  "hexagon",
  "castle",
] as const;
export type PinShape = (typeof PIN_SHAPES)[number];

/** 形の指定が無いシリーズ・シリーズ未設定のスポットで使う形 */
export const DEFAULT_PIN_SHAPE: PinShape = "circle";

/**
 * 自前の形を書くときの座標系。**幅100・高さ145の箱**に、SVGのパス(`d`)で描く。
 * 145 は「頭100 + とんがり45」の比で、組み込みの形と同じ縦横比になる。
 *
 * **箱の下端中央(50,145)がスポットの位置**(symbolレイヤーは`icon-anchor: bottom`)。
 * とんがりを付けたければそこまで伸ばし、付けないなら図形の下端がその位置に接する。
 * 中身(シリーズのラベル・アイコン)は**頭の中心(50,50)**に描くので、そこは塗りで覆うこと
 * (中身の色は塗りに対して読める色が選ばれるため、空けると地図に直接文字が乗る)。
 */
export const PIN_PATH_VIEW_WIDTH = 100;
export const PIN_PATH_VIEW_HEIGHT = 145;

/** `iconViewSize`を省いたときの座標系(Simple Iconsなどと同じ24×24) */
export const PIN_ICON_VIEW_SIZE = 24;

/**
 * パス(`d`)として妥当な文字だけでできているか。**canvasはパスを描くだけで
 * スクリプトを実行しないので危険は無い**が、打ち間違いを黙って空のピンにしない
 * ための最低限の検査(Path2Dは不正な断片を例外にせず無視する)。
 */
const PATH_D_RE = /^[Mm][\s0-9.,+\-eE]*[MmLlHhVvCcSsQqTtAaZz][A-Za-z0-9.,+\-eE\s]*$/;

export function isValidPinPath(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= 4000 && PATH_D_RE.test(v);
}

export function isPinShape(v: unknown): v is PinShape {
  return typeof v === "string" && (PIN_SHAPES as readonly string[]).includes(v);
}

/** ピンの中に描くアイコン(解決済み) */
export interface PinIconSpec {
  path: string;
  /** パスが描かれている正方形の一辺 */
  viewSize: number;
}

/** 解決済みの形。文字列なら組み込み、オブジェクトなら自前のパス */
export type PinShapeSpec = PinShape | { path: string };
