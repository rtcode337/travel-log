import type { StyleSpecification } from "maplibre-gl";

/** OpenStreetMap ラスタタイルを使った無料のマップスタイル */
export const osmStyle: StyleSpecification = {
  version: 8,
  // クラスタの件数ラベル(symbolレイヤーのtext-field)を描画するためのフォント。
  // MapLibre公式のデモグリフサーバー(無料・APIキー不要)を利用する。
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
    },
  ],
};

/** 日本全体が入る初期表示(現在地が取得できない場合のフォールバック) */
export const JAPAN_CENTER: [number, number] = [137.0, 37.5];
export const JAPAN_ZOOM = 4.5;

/** 現在地取得後にズームインする際のズームレベル */
export const CURRENT_LOCATION_ZOOM = 14;
