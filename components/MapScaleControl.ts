import type { IControl, Map as MapLibreMap } from "@/lib/maplibre";
import { niceScaleMeters, SCALE_DIVISIONS, scaleLabels } from "@/lib/mapScale";

/**
 * 物差しに使える最大の長さ(px)。この中で切りのよい距離になる長さへ縮める。
 * 切りのよい値は 1・2・5 刻みなので、**短いときは最大の 4 割まで縮む**(2 の倍が 5 に届かない
 * とき)。120 では 48px まで縮み、真ん中と右端の数字(「100」と「200km」)がぶつかった。
 * 160 なら 64px 残り、数字の間に隙間ができる
 */
const MAX_WIDTH = 160;
/** 数字が物差しの端からはみ出すぶんの余白(「1000m」は右端の目盛りを中心に左右へ広がる) */
const PAD = 22;
const HEIGHT = 30;
/** 物差しの横線の高さ(y)と、目盛りの上端(長い目盛り・短い目盛り) */
const BAR_Y = 26;
const MAJOR_TOP = 15;
const MINOR_TOP = 20;

/**
 * 地図の縮尺。紙の地図によくある**目盛りの付いた物差し**(「0 ・ 500 ・ 1000m」)を描く。
 *
 * MapLibre の`ScaleControl`は「200 km」の文字と枠だけで、どこからどこまでがその距離かが
 * 読みにくい。距離の測り方は同じ —— 地図の縦の真ん中で、左端から`MAX_WIDTH`の 2 点の距離を
 * 測り、それ以下の切りのよい値(`niceScaleMeters`)に合わせて物差しを縮める。
 *
 * **地図の上で読めるよう、線も文字も白で縁取る**(写真やタイルの上に黒だけで描くと、
 * 濃い色の地面で消える)。動かすたび(`move`)に描き直す。
 */
export default class MapScaleControl implements IControl {
  private map: MapLibreMap | null = null;
  private container: HTMLDivElement | null = null;
  private readonly update = () => this.render();

  onAdd(map: MapLibreMap): HTMLElement {
    this.map = map;
    const container = document.createElement("div");
    container.className = "maplibregl-ctrl";
    container.setAttribute("aria-hidden", "true");
    this.container = container;
    map.on("move", this.update);
    this.render();
    return container;
  }

  onRemove(): void {
    this.map?.off("move", this.update);
    this.container?.remove();
    this.map = null;
    this.container = null;
  }

  private render(): void {
    const map = this.map;
    const container = this.container;
    if (!map || !container) return;
    const y = map.getContainer().clientHeight / 2;
    const maxMeters = map.unproject([0, y]).distanceTo(map.unproject([MAX_WIDTH, y]));
    const meters = niceScaleMeters(maxMeters);
    if (meters === 0) {
      container.innerHTML = "";
      return;
    }
    // **長さは丸めない**(整数のピクセルに丸めると、そのぶん距離がずれる。SVG は小数で描ける)
    const width = (MAX_WIDTH * meters) / maxMeters;
    const { half, full } = scaleLabels(meters);
    const x = (ratio: number) => PAD + width * ratio;

    const ticks: string[] = [];
    for (let i = 0; i <= SCALE_DIVISIONS; i++) {
      const major = i === 0 || i === SCALE_DIVISIONS || i * 2 === SCALE_DIVISIONS;
      const tx = x(i / SCALE_DIVISIONS);
      ticks.push(`M${tx},${major ? MAJOR_TOP : MINOR_TOP}V${BAR_Y}`);
    }
    const lines = `M${x(0)},${BAR_Y}H${x(1)} ${ticks.join(" ")}`;
    const label = (text: string, ratio: number) =>
      `<text x="${x(ratio)}" y="11" text-anchor="middle">${text}</text>`;

    container.innerHTML =
      `<svg width="${Math.ceil(width + PAD * 2)}" height="${HEIGHT}" style="display:block">` +
      // 下に太い白、上に細い黒(縁取り)
      `<path d="${lines}" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="square"/>` +
      `<path d="${lines}" fill="none" stroke="#111" stroke-width="1.5" stroke-linecap="square"/>` +
      `<g font-size="11" font-weight="700" fill="#111" stroke="#fff" stroke-width="3" ` +
      `paint-order="stroke" stroke-linejoin="round">` +
      label("0", 0) +
      label(half, 0.5) +
      label(full, 1) +
      `</g></svg>`;
  }
}
