"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api } from "@/lib/api-client";
import {
  osmStyle,
  JAPAN_CENTER,
  JAPAN_ZOOM,
  WORLD_CENTER,
  WORLD_ZOOM,
  CURRENT_LOCATION_ZOOM,
} from "@/lib/mapStyle";
import { useRegionScope } from "@/lib/useRegionScope";
import { DEFAULT_REGION_SCOPE } from "@/lib/region";
import type { Role, Spot, SpotRoute, SpotType, Visit } from "@/lib/types";
import { expandSpot, readSpotCacheDb } from "@/lib/spotCacheDb";
import { autoTextColor, type SeriesStyleDefinition } from "@/lib/seriesStyle";
import { ensurePinImage, pinIconId, PIN_ICON_PAD } from "@/lib/pinIcon";
import {
  downloadSpotCacheFor,
  formatBytes,
  formatDownloadedAt,
  useSpotCache,
  type DownloadProgress,
} from "@/lib/useSpotCache";
import { useSeriesStyles } from "@/lib/useSeriesStyles";
import { useCategories } from "@/lib/useCategories";
import FilterBar, {
  DEFAULT_FILTERS,
  FilterResetButton,
  hasActiveFilters,
  passesFilters,
  toVisitDateKey,
  type SpotFilters,
  type VisitedValue,
} from "@/components/FilterBar";
import AddSpotModal from "@/components/AddSpotModal";
import SpotDetailModal from "@/components/SpotDetailModal";
import SpotDownloadDialogs, {
  DownloadProgressDialog,
} from "@/components/SpotDownloadDialogs";

const CLUSTER_SOURCE_ID = "spots-cluster";
const CLUSTER_LAYER_ID = "spots-clusters";
const CLUSTER_COUNT_LAYER_ID = "spots-cluster-count";
const UNCLUSTERED_LAYER_ID = "spots-unclustered-point";

const ROUTES_SOURCE_ID = "spot-routes";
const ROUTE_LINE_LAYER_ID = "spot-routes-line";
const ROUTE_ARROW_LAYER_ID = "spot-routes-arrow";
const ROUTE_HIT_LAYER_ID = "spot-routes-hit";

// 別のスポット種別を半透明で重ねて表示するためのsource/layer群(本体と独立)
const OVERLAY_SOURCE_ID = "overlay-spots";
const OVERLAY_CLUSTER_LAYER_ID = "overlay-clusters";
const OVERLAY_CLUSTER_COUNT_LAYER_ID = "overlay-cluster-count";
const OVERLAY_UNCLUSTERED_LAYER_ID = "overlay-unclustered-point";
const OVERLAY_ROUTES_SOURCE_ID = "overlay-routes";
const OVERLAY_ROUTE_LINE_LAYER_ID = "overlay-routes-line";
const OVERLAY_ROUTE_ARROW_LAYER_ID = "overlay-routes-arrow";
const OVERLAY_ROUTE_HIT_LAYER_ID = "overlay-routes-hit";

/** 重ね表示の不透明度(本体のスポットと見分けるための半透明) */
const OVERLAY_OPACITY = 0.55;
const OVERLAY_LINE_OPACITY = 0.45;

const MAIN_PIN_LAYERS = [CLUSTER_LAYER_ID, UNCLUSTERED_LAYER_ID];
const OVERLAY_PIN_LAYERS = [OVERLAY_CLUSTER_LAYER_ID, OVERLAY_UNCLUSTERED_LAYER_ID];

/**
 * 指定座標に、指定レイヤー群のいずれかの描画があるか(存在しないレイヤーは無視)。
 * タップの優先順位付けに使う: ①重ね表示のピン・クラスタ ②本体のピン・クラスタ
 * ③重ね表示のルート ④本体のルート の順で、上位が吸ったタップは下位に渡さない
 */
function hasFeatureAt(
  map: maplibregl.Map,
  point: maplibregl.PointLike,
  layerIds: string[]
): boolean {
  const layers = layerIds.filter((id) => map.getLayer(id));
  return (
    layers.length > 0 && map.queryRenderedFeatures(point, { layers }).length > 0
  );
}

/** ルートにシリーズが設定されていない(または種別の一覧に無い)ときの矢印色 */
const DEFAULT_ROUTE_COLOR = "#2563eb";

/** 訪問日で絞り込み中に描く「訪問順」の線・矢印の色(ルートCSVの線と区別できる色) */
const VISIT_PATH_COLOR = "#9333ea";

/**
 * ルートの進行方向を示す右向き矢印(白フチ付き)の画像を色ごとに生成して登録する。
 * symbol-placement: "line" のシンボルはライン方向に回転して置かれるため、
 * 「右向き」がそのまま巡った順の向きになる。冪等・同期
 */
function ensureRouteArrowImage(map: maplibregl.Map, color: string): string {
  const id = `route-arrow-${color}`;
  if (map.hasImage(id)) return id;

  const ratio = 2;
  const w = 14;
  const h = 14;
  const canvas = document.createElement("canvas");
  canvas.width = w * ratio;
  canvas.height = h * ratio;
  const ctx = canvas.getContext("2d");
  if (!ctx) return id;
  ctx.scale(ratio, ratio);

  ctx.beginPath();
  ctx.moveTo(3, 2.5);
  ctx.lineTo(12, 7);
  ctx.lineTo(3, 11.5);
  ctx.closePath();
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();

  map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), {
    pixelRatio: ratio,
  });
  return id;
}

/**
 * ルート用のsource/layerを(まだなければ)追加する。冪等。
 * ピンのクラスタレイヤーが既にあればその下に挿し込み、無ければそのまま追加する
 * (クラスタレイヤーは後から追加されるとルートの上に載るため、どちらの順でもピンが上になる)。
 * onSelectRouteはルートの線・矢印のタップで呼ぶ(ルート詳細モーダルを開く)。
 * 初回のレイヤー作成時にしか登録しないため、再レンダーで変わらない関数
 * (setStateなど)を渡すこと
 */
function ensureRouteLayers(
  map: maplibregl.Map,
  onSelectRoute: (routeId: string) => void
) {
  if (map.getSource(ROUTES_SOURCE_ID)) return;

  map.addSource(ROUTES_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  const beforeId = map.getLayer(CLUSTER_LAYER_ID) ? CLUSTER_LAYER_ID : undefined;
  map.addLayer(
    {
      id: ROUTE_LINE_LAYER_ID,
      type: "line",
      source: ROUTES_SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ["get", "color"],
        "line-width": 2.5,
        "line-opacity": 0.8,
      },
    },
    beforeId
  );
  map.addLayer(
    {
      id: ROUTE_ARROW_LAYER_ID,
      type: "symbol",
      source: ROUTES_SOURCE_ID,
      layout: {
        "symbol-placement": "line",
        "symbol-spacing": 70,
        "icon-image": ["get", "icon"],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
      },
    },
    beforeId
  );
  // タップの当たり判定用の透明な太い線(2.5pxの線そのものは指で正確に
  // 押せないため)。queryRenderedFeaturesは不透明度に関係なく形状で判定する
  map.addLayer(
    {
      id: ROUTE_HIT_LAYER_ID,
      type: "line",
      source: ROUTES_SOURCE_ID,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-width": 22, "line-opacity": 0 },
    },
    beforeId
  );

  map.on("click", ROUTE_HIT_LAYER_ID, (e) => {
    // ピン・クラスタ(重ね表示・本体どちらも)と重なった位置のタップはピン側の操作
    // (スポット詳細・クラスタ展開)を優先し、重ね表示のルートと重なった位置は
    // 重ね表示側が吸う
    if (
      hasFeatureAt(map, e.point, [
        ...OVERLAY_PIN_LAYERS,
        ...MAIN_PIN_LAYERS,
        OVERLAY_ROUTE_HIT_LAYER_ID,
      ])
    ) {
      return;
    }
    // 訪問順の経路(routeIdなし)はルートではないため対象外
    const routeId = e.features?.find(
      (f) => typeof f.properties?.routeId === "string"
    )?.properties?.routeId;
    if (routeId) onSelectRoute(routeId);
  });
  map.on("mouseenter", ROUTE_HIT_LAYER_ID, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", ROUTE_HIT_LAYER_ID, () => {
    map.getCanvas().style.cursor = "";
  });
}

/**
 * 別種別の重ね表示用のsource/layerを(まだなければ)追加する。冪等。
 * 本体のレイヤーの上に置く(タップも重ね表示側が優先)ため、beforeIdは指定せず
 * 最上位へ追加し、以後の描画のたびにmoveOverlayLayersToTopで最上位を維持する。
 * コールバックは初回のレイヤー作成時にしか登録しないため、再レンダーで変わらない
 * 関数(setState)を渡すこと
 */
function ensureOverlayLayers(
  map: maplibregl.Map,
  onSelectSpot: (id: string) => void,
  onSelectRoute: (routeId: string) => void
) {
  if (map.getSource(OVERLAY_SOURCE_ID)) return;

  // ルート(線・矢印・当たり判定)。重ね表示のピンより下になるよう先に追加する
  map.addSource(OVERLAY_ROUTES_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: OVERLAY_ROUTE_LINE_LAYER_ID,
    type: "line",
    source: OVERLAY_ROUTES_SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-width": 2.5,
      "line-opacity": OVERLAY_LINE_OPACITY,
    },
  });
  map.addLayer({
    id: OVERLAY_ROUTE_ARROW_LAYER_ID,
    type: "symbol",
    source: OVERLAY_ROUTES_SOURCE_ID,
    layout: {
      "symbol-placement": "line",
      "symbol-spacing": 70,
      "icon-image": ["get", "icon"],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: { "icon-opacity": OVERLAY_OPACITY },
  });
  map.addLayer({
    id: OVERLAY_ROUTE_HIT_LAYER_ID,
    type: "line",
    source: OVERLAY_ROUTES_SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-width": 22, "line-opacity": 0 },
  });

  map.addSource(OVERLAY_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterMaxZoom: 16,
    clusterRadius: 50,
  });
  map.addLayer({
    id: OVERLAY_CLUSTER_LAYER_ID,
    type: "circle",
    source: OVERLAY_SOURCE_ID,
    filter: ["has", "point_count"],
    paint: {
      // circle-colorは初期値。描画時に重ね先の種別の先頭シリーズの色で上書きされる
      // (対応するtext-colorの上書きも同様)
      "circle-color": "#2563eb",
      "circle-opacity": OVERLAY_OPACITY * 0.85,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
      "circle-stroke-opacity": OVERLAY_OPACITY,
      "circle-radius": [
        "step",
        ["get", "point_count"],
        14,
        50, 18,
        500, 24,
        2000, 30,
      ],
    },
  });
  map.addLayer({
    id: OVERLAY_CLUSTER_COUNT_LAYER_ID,
    type: "symbol",
    source: OVERLAY_SOURCE_ID,
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
    },
    paint: { "text-color": "#ffffff", "text-opacity": 0.9 },
  });
  map.addLayer({
    id: OVERLAY_UNCLUSTERED_LAYER_ID,
    type: "symbol",
    source: OVERLAY_SOURCE_ID,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "icon-image": ["get", "icon"],
      "icon-anchor": "bottom",
      "icon-offset": [0, PIN_ICON_PAD],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
    paint: { "icon-opacity": OVERLAY_OPACITY },
  });

  map.on("click", OVERLAY_CLUSTER_LAYER_ID, async (e) => {
    const features = map.queryRenderedFeatures(e.point, {
      layers: [OVERLAY_CLUSTER_LAYER_ID],
    });
    const clusterId = features[0]?.properties?.cluster_id;
    if (clusterId == null) return;
    const source = map.getSource(OVERLAY_SOURCE_ID) as maplibregl.GeoJSONSource;
    const zoom = await source.getClusterExpansionZoom(clusterId);
    map.easeTo({
      center: (features[0].geometry as GeoJSON.Point).coordinates as [
        number,
        number,
      ],
      zoom,
    });
  });

  map.on("click", OVERLAY_UNCLUSTERED_LAYER_ID, (e) => {
    const id = e.features?.[0]?.properties?.id;
    if (id) onSelectSpot(id);
  });

  map.on("click", OVERLAY_ROUTE_HIT_LAYER_ID, (e) => {
    // ピン(重ね表示・本体どちらも)と重なった位置のタップはピン側を優先する
    if (hasFeatureAt(map, e.point, [...OVERLAY_PIN_LAYERS, ...MAIN_PIN_LAYERS])) {
      return;
    }
    const routeId = e.features?.find(
      (f) => typeof f.properties?.routeId === "string"
    )?.properties?.routeId;
    if (routeId) onSelectRoute(routeId);
  });

  for (const layerId of [
    OVERLAY_CLUSTER_LAYER_ID,
    OVERLAY_UNCLUSTERED_LAYER_ID,
    OVERLAY_ROUTE_HIT_LAYER_ID,
  ]) {
    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  }
}

/**
 * 重ね表示のレイヤーを描画順の最上位へ移動する(本体のレイヤーが後から追加されても
 * 「半透明の重ね表示が上・タップも重ね表示優先」を維持するため、描画のたびに呼ぶ)
 */
function moveOverlayLayersToTop(map: maplibregl.Map) {
  for (const id of [
    OVERLAY_ROUTE_LINE_LAYER_ID,
    OVERLAY_ROUTE_ARROW_LAYER_ID,
    OVERLAY_ROUTE_HIT_LAYER_ID,
    OVERLAY_CLUSTER_LAYER_ID,
    OVERLAY_CLUSTER_COUNT_LAYER_ID,
    OVERLAY_UNCLUSTERED_LAYER_ID,
  ]) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

/**
 * シリーズ・カテゴリの絞り込みを適用した表示対象のルート(経由地2点以上)を返す。
 * 表示するかどうか自体は絞り込みモーダルの「ルートを表示」トグル
 * (`filters.showRoutes`)だけで決まり、オフなら一切表示しない
 * (かつての「シリーズ・カテゴリで絞り込み中のみ自動表示」ルールは廃止した)。
 * オンならシリーズ・カテゴリの絞り込みが無くても全ルートを表示する。
 *
 * シリーズで絞り込んでいるときは、ルートのseriesがこの種別のシリーズ一覧に
 * あるものだけ絞り込みに連動して出し分け、シリーズ未指定・一覧に無いシリーズの
 * ルートは対象外として表示する。カテゴリで絞り込んでいるときは、ルート自体は
 * カテゴリを持たない(`spot_routes`にcategories相当の列は無い)ため、経由地の
 * カテゴリで代用して「選択中のカテゴリを持つ経由地が1つでもあるルート」を表示する。
 * ただしこの判定に使う経由地は、**そのルートのシリーズに属するスポットがあれば
 * それだけ**に絞る(`routeOwnPoints`) — 乗り換え駅・空港のように複数のルートで
 * 共有している経由地に引きずられて、無関係なルートまで表示されるのを防ぐため
 * (例: 「サイコロ1」のスポットである新大阪駅を「サイコロ4」「サイコロ5」
 * 「サイコロ6」のルートも通っているせいで、カテゴリ=サイコロ1で絞ると
 * サイコロ4〜6のルート線まで出ていた)。シリーズが未指定のルートや、自分の
 * シリーズの経由地が1つも無いルートは従来どおり全経由地で判定する。
 * 両方で絞り込んでいるときは両方の条件を満たすルートのみ。
 */
function filterVisibleRoutes(
  routes: SpotRoute[],
  filters: SpotFilters,
  seriesStyles: SeriesStyleDefinition[],
  spotById: Map<string, Spot>
): SpotRoute[] {
  if (!filters.showRoutes) return [];
  const knownSeries = new Set(seriesStyles.map((s) => s.series));
  return routes.filter((route) => {
    if (route.points.length < 2) return false;
    if (
      filters.series.length > 0 &&
      route.series !== null &&
      knownSeries.has(route.series) &&
      !filters.series.includes(route.series)
    ) {
      return false;
    }
    if (
      filters.categories.length > 0 &&
      !routeOwnPoints(route, spotById).some((s) =>
        s.categories.some((c) => filters.categories.includes(c))
      )
    ) {
      return false;
    }
    return true;
  });
}

/**
 * カテゴリ絞り込みでルートを判定するときに見る経由地スポットを返す。
 * ルートのシリーズと同じシリーズのスポットがあればそれだけ、無ければ全経由地。
 * (取得できないスポット=他人の非公開等は除く)
 */
function routeOwnPoints(route: SpotRoute, spotById: Map<string, Spot>): Spot[] {
  const spots = route.points
    .map((p) => spotById.get(p.spot_id))
    .filter((s): s is Spot => s !== undefined);
  if (route.series === null) return spots;
  const own = spots.filter((s) => s.series === route.series);
  return own.length > 0 ? own : spots;
}

/**
 * 訪問日で絞り込んでいるとき、その日の訪問を訪問時刻の昇順に並べた経路を返す。
 * この種別に無いスポット(他の種別の訪問記録)は除く。
 * 同じスポットへの再訪はそのまま複数回現れる(行って戻る線になる)が、
 * 連続する同じスポットへの訪問(同じ場所で複数回記録した場合)はまとめる
 * (長さ0の線分になり、矢印の向きが定まらないため)。
 */
function buildVisitPath(
  visits: Visit[],
  filters: SpotFilters,
  spotById: Map<string, Spot>
): Spot[] {
  const date = filters.visitedDate;
  if (!date) return [];
  return visits
    .flatMap((visit) => {
      if (toVisitDateKey(visit.visited_on) !== date) return [];
      const spot = spotById.get(visit.spot_id);
      return spot ? [{ time: Date.parse(visit.visited_on!), spot }] : [];
    })
    .sort((a, b) => a.time - b.time)
    .map((v) => v.spot)
    .filter((spot, i, list) => i === 0 || spot.id !== list[i - 1].id);
}

/** routeIdはタップでルート詳細を開くのに使う(訪問順の経路には付けない) */
type RouteFeatureProps = { color: string; icon: string; routeId?: string };

/**
 * ルート(と、訪問日で絞り込み中なら訪問順の経路)をGeoJSONのLineString群にする。
 * 矢印画像の登録もここで済ませる
 */
function buildRouteGeoJSON(
  map: maplibregl.Map,
  routes: SpotRoute[],
  seriesStyles: SeriesStyleDefinition[],
  visitPath: Spot[]
): GeoJSON.FeatureCollection<GeoJSON.LineString, RouteFeatureProps> {
  const visitFeatures: GeoJSON.Feature<GeoJSON.LineString, RouteFeatureProps>[] =
    visitPath.length >= 2
      ? [
          {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: visitPath.map((s) => [s.lng, s.lat]),
            },
            properties: {
              color: VISIT_PATH_COLOR,
              icon: ensureRouteArrowImage(map, VISIT_PATH_COLOR),
            },
          },
        ]
      : [];

  return {
    type: "FeatureCollection",
    features: [
      ...visitFeatures,
      ...routes.map<GeoJSON.Feature<GeoJSON.LineString, RouteFeatureProps>>(
        (route) => {
          // ルートのシリーズが種別の一覧にあれば、そのシリーズの縁取り色
          // (地の色より濃く、地図上で見やすい)で描く
          const color =
            seriesStyles.find((s) => s.series === route.series)?.borderColor ??
            DEFAULT_ROUTE_COLOR;
          return {
            type: "Feature",
            geometry: {
              type: "LineString",
              coordinates: route.points.map((p) => [p.lng, p.lat]),
            },
            properties: {
              color,
              icon: ensureRouteArrowImage(map, color),
              routeId: route.id,
            },
          };
        }
      ),
    ],
  };
}

type ClusterFeatureProps = {
  id: string;
  series: string | null;
  visited: boolean;
  /** ensurePinImageで登録済みのピン画像ID */
  icon: string;
};

function buildClusterGeoJSON(
  spots: Spot[],
  visitedIds: Set<string>,
  seriesStyles: SeriesStyleDefinition[]
): GeoJSON.FeatureCollection<GeoJSON.Point, ClusterFeatureProps> {
  return {
    type: "FeatureCollection",
    features: spots.map((spot) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [spot.lng, spot.lat] },
      properties: {
        id: spot.id,
        series: spot.series,
        visited: visitedIds.has(spot.id),
        icon: pinIconId(
          spot.series,
          visitedIds.has(spot.id),
          spot.status === "private",
          seriesStyles
        ),
      },
    })),
  };
}

/** クラスタ用のsource/layerを(まだなければ)追加する。冪等 */
function ensureClusterLayers(
  map: maplibregl.Map,
  onSelectSpot: (id: string) => void
) {
  if (map.getSource(CLUSTER_SOURCE_ID)) return;

  map.addSource(CLUSTER_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterMaxZoom: 16,
    clusterRadius: 50,
  });

  map.addLayer({
    id: CLUSTER_LAYER_ID,
    type: "circle",
    source: CLUSTER_SOURCE_ID,
    filter: ["has", "point_count"],
    paint: {
      "circle-color": "#2563eb",
      "circle-opacity": 0.85,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#ffffff",
      "circle-radius": [
        "step",
        ["get", "point_count"],
        14,
        50, 18,
        500, 24,
        2000, 30,
      ],
    },
  });

  map.addLayer({
    id: CLUSTER_COUNT_LAYER_ID,
    type: "symbol",
    source: CLUSTER_SOURCE_ID,
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
    },
    paint: {
      "text-color": "#ffffff",
    },
  });

  // 下がとんがった吹き出し型のピン画像(シリーズ文字・チェックマーク込みで
  // lib/pinIcon.tsが生成し、GeoJSON側のiconプロパティでIDを指定する)。
  // とんがりの先端がスポットの座標を指すようにicon-anchorはbottomにする
  map.addLayer({
    id: UNCLUSTERED_LAYER_ID,
    type: "symbol",
    source: CLUSTER_SOURCE_ID,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "icon-image": ["get", "icon"],
      "icon-anchor": "bottom",
      // 画像下端の影用余白の分だけ押し下げ、とんがりの先端を座標に一致させる
      "icon-offset": [0, PIN_ICON_PAD],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });

  map.on("click", CLUSTER_LAYER_ID, async (e) => {
    // 重ね表示のピン・クラスタと重なった位置のタップは重ね表示側が吸う
    if (hasFeatureAt(map, e.point, OVERLAY_PIN_LAYERS)) return;
    const features = map.queryRenderedFeatures(e.point, {
      layers: [CLUSTER_LAYER_ID],
    });
    const clusterId = features[0]?.properties?.cluster_id;
    if (clusterId == null) return;
    const source = map.getSource(CLUSTER_SOURCE_ID) as maplibregl.GeoJSONSource;
    const zoom = await source.getClusterExpansionZoom(clusterId);
    map.easeTo({
      center: (features[0].geometry as GeoJSON.Point).coordinates as [
        number,
        number,
      ],
      zoom,
    });
  });

  map.on("click", UNCLUSTERED_LAYER_ID, (e) => {
    // 重ね表示のピン・クラスタと重なった位置のタップは重ね表示側が吸う
    if (hasFeatureAt(map, e.point, OVERLAY_PIN_LAYERS)) return;
    const id = e.features?.[0]?.properties?.id;
    if (id) onSelectSpot(id);
  });

  for (const layerId of [CLUSTER_LAYER_ID, UNCLUSTERED_LAYER_ID]) {
    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  }
}

function showClusterLayers(map: maplibregl.Map) {
  for (const id of [
    CLUSTER_LAYER_ID,
    CLUSTER_COUNT_LAYER_ID,
    UNCLUSTERED_LAYER_ID,
  ]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", "visible");
  }
}

/**
 * 直前に表示していた地図の中心・ズームをスポット種別ごとに覚えておく
 * (モジュールスコープの変数なので他画面へ遷移してMapViewがアンマウントされても、
 * 同じセッション内であれば保持される)。これがあれば再訪時は現在地取得をせず
 * そのまま復元し、なければ(このセッションで初めてその種別の/mapを開いたとき)
 * 初期表示の決定(日本の種別は現在地取得、それ以外はスポット全体へのフィット)に進む。
 * 種別ごとに分けるのは、日本の種別と海外の種別を行き来したとき、直前の種別の
 * 表示位置を引き継いでも意味がないため。
 */
const lastViews = new Map<string, { center: [number, number]; zoom: number }>();

/**
 * 地図でかけた絞り込み条件はスポット種別ごとにlocalStorageへ保存し、
 * 他画面から戻ったときだけでなく、アプリ(PWA)やブラウザを完全に落として
 * 開き直したときも復元する(表示位置のlastViewsと違い、再読み込みでは消えない)。
 */
const FILTERS_STORAGE_PREFIX = "travel-log:map-filters:";

/** 保存済みの絞り込み条件を読む。未保存・不正値はDEFAULT_FILTERS(参照も同じ)を返す */
function loadSavedFilters(typeKey: string): SpotFilters {
  if (typeof localStorage === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_PREFIX + typeKey);
    if (!raw) return DEFAULT_FILTERS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_FILTERS;
    const obj = parsed as Record<string, unknown>;
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    // 訪問日は`YYYY-MM-DD`のみ受け付ける(input[type=date]が扱える形)
    const date = (v: unknown): string | null =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    const filters: SpotFilters = {
      series: strings(obj.series),
      categories: strings(obj.categories),
      visited: strings(obj.visited).filter(
        (v): v is VisitedValue => v === "visited" || v === "unvisited"
      ),
      visitedDate: date(obj.visitedDate),
      // キー自体が無い保存データ(この設定の追加前に保存されたもの)は既定のオン扱い
      showRoutes: typeof obj.showRoutes === "boolean" ? obj.showRoutes : true,
    };
    // 全項目が既定どおりなら参照もDEFAULT_FILTERSに揃える。showRoutesは
    // hasActiveFiltersに含まれない(絞り込みではない)ため別途比較する
    if (!hasActiveFilters(filters) && filters.showRoutes === DEFAULT_FILTERS.showRoutes) {
      return DEFAULT_FILTERS;
    }
    return filters;
  } catch {
    return DEFAULT_FILTERS;
  }
}

function saveFilters(typeKey: string, filters: SpotFilters) {
  try {
    localStorage.setItem(FILTERS_STORAGE_PREFIX + typeKey, JSON.stringify(filters));
  } catch {
    // プライベートブラウズ等で保存できなくても絞り込み自体は動かす
  }
}

/** 重ね表示する種別の選択も、絞り込み条件と同様に(表示中の)種別ごとに保存・復元する */
const OVERLAY_STORAGE_PREFIX = "travel-log:map-overlay:";

function loadSavedOverlayTypeKey(typeKey: string): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const value = localStorage.getItem(OVERLAY_STORAGE_PREFIX + typeKey);
    // 自分自身を重ねる設定は不正値として無視する
    return value && value !== typeKey ? value : null;
  } catch {
    return null;
  }
}

function saveOverlayTypeKey(typeKey: string, overlay: string | null) {
  try {
    if (overlay) {
      localStorage.setItem(OVERLAY_STORAGE_PREFIX + typeKey, overlay);
    } else {
      localStorage.removeItem(OVERLAY_STORAGE_PREFIX + typeKey);
    }
  } catch {
    // 保存できなくてもこのセッションの重ね表示自体は動かす
  }
}

/**
 * 現在地追跡モード(GeolocateControlのカメラ追従=ACTIVE_LOCK状態)だったかどうかも
 * 同様にモジュールスコープで記憶する。追跡中に他画面へ遷移するとMapViewのアンマウントで
 * GeolocateControlごとwatchPositionが破棄されるため、再訪時にこのフラグを見て
 * trigger()し直すことで追跡モードを復元する(古い座標に仮の丸を置くのではなく、
 * 位置情報の取得とカメラ追従そのものを再開する)。
 * 地図上をドラッグして追従が切れた状態(BACKGROUND)は「追跡モード」とはみなさない
 * (trackuserlocationendで即座にfalseへ落とす)。
 */
let lastTrackingActive = false;

export default function MapView({
  spotTypeKey,
}: {
  /** 表示対象のスポット種別キー(常に /[type]/map から渡される) */
  spotTypeKey: string;
}) {
  const searchParams = useSearchParams();
  const focusSpotId = searchParams.get("spot");
  // 「◯◯」の地図で開くリンク(重ね表示のスポット詳細)で種別を切り替えて来たとき、
  // 元の種別のキーがfromに入る。左下に「元の地図に戻る」リンクを出すのに使う
  // (戻り先の表示位置は種別ごとのlastViewsが復元するため、キーだけあればよい)
  const returnTypeKey = searchParams.get("from");
  // /map?filter=1 で開かれたら絞り込みモーダルを最初から開く(重ね表示元の地図の
  // 「「◯◯」の地図で絞り込みを編集」リンクから遷移してきたとき)
  const openFilterParam = searchParams.get("filter");

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  /**
   * スタイル(レイヤー追加等が可能な状態)になったかどうかと、それを待っている処理。
   * isStyleLoaded()はタイル読み込み中などスタイル適用後でもfalseを返すことがあり、
   * loadイベントはタイルが読めない環境では発火しないことがあるため、どちらにも
   * 依存せず「styledataが一度でも発火したか」で判定する(スタイルは同梱のJSONなので
   * styledataは必ず発火する)。準備完了前に来た描画処理はpendingに積んで発火時に流す
   */
  const mapReadyRef = useRef(false);
  const pendingMapReadyRef = useRef<(() => void)[]>([]);

  /** fnをスタイル準備完了後に(完了済みなら即座に)実行する */
  const runWhenMapReady = useCallback((fn: () => void) => {
    const map = mapRef.current;
    if (!map) return;
    if (mapReadyRef.current || map.isStyleLoaded()) {
      mapReadyRef.current = true;
      fn();
    } else {
      pendingMapReadyRef.current.push(fn);
    }
  }, []);

  const spotCache = useSpotCache(spotTypeKey);
  const seriesStyles = useSeriesStyles(spotTypeKey);
  // 種別のカテゴリ設定。絞り込みチップの並び順に使う
  const categories = useCategories(spotTypeKey);
  // 種別の対象地域スコープ。地名検索の対象国と、初回表示時の挙動
  // (日本=現在地へズーム、それ以外=スポット全体にフィット)に使う
  const regionScope = useRegionScope(spotTypeKey);
  const [privateSpots, setPrivateSpots] = useState<Spot[]>([]);
  // この種別の公開ルート(スポットを巡った順の矢印)。管理画面のルートCSVインポートで
  // 作られ、公開スポットのダウンロード時に一緒にキャッシュへ保存されたものを使う
  const routes = useMemo(
    () => spotCache.publicRoutes ?? [],
    [spotCache.publicRoutes]
  );
  const spots = useMemo(
    () => [...(spotCache.publicSpots ?? []), ...privateSpots],
    [spotCache.publicSpots, privateSpots]
  );
  // 自分の訪問記録(全種別分)。ピンの訪問済み表示のほか、訪問日での絞り込みと
  // 訪問順の矢印(buildVisitPath)に訪問日時が要るため、IDの集合ではなく全件を持つ
  const [visits, setVisits] = useState<Visit[]>([]);
  const visitedIds = useMemo(
    () => new Set(visits.map((v) => v.spot_id)),
    [visits]
  );
  /** spot_id → そのスポットを訪問した日(ローカル日付。日時不明の訪問は含めない) */
  const visitedDatesBySpot = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const v of visits) {
      const date = toVisitDateKey(v.visited_on);
      if (!date) continue;
      const list = m.get(v.spot_id);
      if (list) list.push(date);
      else m.set(v.spot_id, [date]);
    }
    return m;
  }, [visits]);
  const spotById = useMemo(() => {
    const m = new Map<string, Spot>();
    for (const s of spots) m.set(s.id, s);
    return m;
  }, [spots]);
  /**
   * 訪問日ドロップダウンの選択肢(新しい順)。この種別のスポットへの訪問だけを
   * 対象にする(他の種別の訪問記録しかない日を選んでも0件になるため)
   */
  const visitDates = useMemo(() => {
    const set = new Set<string>();
    for (const v of visits) {
      if (!spotById.has(v.spot_id)) continue;
      const date = toVisitDateKey(v.visited_on);
      if (date) set.add(date);
    }
    return Array.from(set).sort((a, b) => b.localeCompare(a));
  }, [visits, spotById]);
  // SSR・hydration時は常に既定(サーバーはlocalStorageを読めないため、初期値で
  // 読むとhydration不一致になる)。保存済み条件の復元はマウント後のuseEffectで行う
  const [filters, setFiltersState] = useState<SpotFilters>(DEFAULT_FILTERS);
  // 変更のたびにlocalStorageへも書き込む(次に地図を開いたときの復元用)
  const setFilters = useCallback(
    (next: SpotFilters) => {
      saveFilters(spotTypeKey, next);
      setFiltersState(next);
    },
    [spotTypeKey]
  );
  // マウント時と、マウント中に種別が切り替わった場合に、その種別の保存済み条件を読む
  useEffect(() => {
    setFiltersState(loadSavedFilters(spotTypeKey));
  }, [spotTypeKey]);
  // 何らかの絞り込みが掛かっているか(絞り込みボタンの見た目に使う。ルート表示のオン/オフは含めない)
  const filtersActive = hasActiveFilters(filters);
  const [detailSpotId, setDetailSpotId] = useState<string | null>(null);
  // タップされたルート(ルート詳細モーダルの表示対象)
  const [detailRouteId, setDetailRouteId] = useState<string | null>(null);

  // 別種別の重ね表示。選択種別はこの種別の設定としてlocalStorageへ保存し、
  // スポットはその種別のダウンロード済みキャッシュ(IndexedDB)から読む。
  // 絞り込み・ルート表示のオン/オフは、その種別の地図で自分が保存した設定に従う
  const [overlayTypeKey, setOverlayTypeKeyState] = useState<string | null>(null);
  const [overlaySpots, setOverlaySpots] = useState<Spot[] | null>(null);
  const [overlayRoutes, setOverlayRoutes] = useState<SpotRoute[]>([]);
  const [overlayFilters, setOverlayFilters] = useState<SpotFilters>(DEFAULT_FILTERS);
  const [overlayMessage, setOverlayMessage] = useState<string | null>(null);
  // 重ね表示の選択肢(全種別の一覧。/api/spot-typesは閲覧可能な種別のみ返す)
  const [spotTypes, setSpotTypes] = useState<SpotType[]>([]);
  const [overlayDetailSpotId, setOverlayDetailSpotId] = useState<string | null>(null);
  const [overlayDetailRouteId, setOverlayDetailRouteId] = useState<string | null>(null);
  // 未ダウンロードの種別を選んだときの「ダウンロードしますか?」確認(値は対象の種別キー)
  const [overlayDownloadPrompt, setOverlayDownloadPrompt] = useState<string | null>(
    null
  );
  const [overlayDownloading, setOverlayDownloading] = useState(false);
  const [overlayProgress, setOverlayProgress] = useState<DownloadProgress | null>(
    null
  );
  const overlayAbortRef = useRef<AbortController | null>(null);
  // 未ダウンロード時にダウンロード確認を出してよいか。ユーザーがセレクトで選んだ
  // 直後だけtrueにする(保存済み選択の復元でキャッシュが無かった場合=後から
  // キャッシュを削除した場合は、地図を開いただけで突然ダイアログが出ないよう
  // 従来どおり黙って選択を解除する)
  const overlayPromptOnMissingRef = useRef(false);
  // 重ね表示が無効の間は使われない(現在種別の値を返すだけ)
  const overlaySeriesStyles = useSeriesStyles(overlayTypeKey ?? spotTypeKey);

  const setOverlayTypeKey = useCallback(
    (next: string | null) => {
      overlayPromptOnMissingRef.current = true;
      saveOverlayTypeKey(spotTypeKey, next);
      setOverlayTypeKeyState(next);
      setOverlayMessage(null);
    },
    [spotTypeKey]
  );

  // 重ね表示の選択も、絞り込み条件と同様に保存済みの値を復元する
  useEffect(() => {
    overlayPromptOnMissingRef.current = false;
    setOverlayTypeKeyState(loadSavedOverlayTypeKey(spotTypeKey));
    setOverlayMessage(null);
  }, [spotTypeKey]);

  // アンマウント時は進行中の重ね表示用ダウンロードを打ち切る
  useEffect(() => () => overlayAbortRef.current?.abort(), []);

  // 重ね表示の選択肢用の種別一覧(GETはapi-client側でキャッシュされる)
  useEffect(() => {
    api.spotTypes.list().then(({ data }) => setSpotTypes(data ?? []));
  }, []);

  // 重ね表示のデータ読み込み。スポットもルートも、その種別のダウンロード済み
  // キャッシュ(公開スポットのダウンロード時に公開ルートも一緒に保存される)から読む
  useEffect(() => {
    if (!overlayTypeKey) {
      setOverlaySpots(null);
      setOverlayRoutes([]);
      return;
    }
    let cancelled = false;
    setOverlayFilters(loadSavedFilters(overlayTypeKey));
    (async () => {
      const stored = await readSpotCacheDb(overlayTypeKey);
      if (cancelled) return;
      if (!stored) {
        if (overlayPromptOnMissingRef.current) {
          // セレクトで選んだ直後なら、その場でダウンロードするか確認する
          // (選択は保持したまま。キャンセル・失敗時にハンドラ側で解除する)
          setOverlayDownloadPrompt(overlayTypeKey);
        } else {
          // 保存済み選択の復元でキャッシュが無かった場合(後からキャッシュを
          // 削除した場合)は、突然ダイアログを出さず黙って選択を解除する
          setOverlayMessage(
            "選んだ種別の公開スポットが未ダウンロードのため重ねられません。もう一度選ぶとダウンロードできます。"
          );
          setOverlayTypeKeyState(null);
          saveOverlayTypeKey(spotTypeKey, null);
        }
        return;
      }
      setOverlaySpots(stored.spots.map(expandSpot));
      setOverlayRoutes(stored.routes ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [overlayTypeKey, spotTypeKey]);

  /** ダウンロード確認の「キャンセル」: 重ね表示の選択ごと解除する */
  const cancelOverlayDownloadPrompt = useCallback(() => {
    setOverlayDownloadPrompt(null);
    setOverlayTypeKey(null);
  }, [setOverlayTypeKey]);

  /**
   * ダウンロード確認の「ダウンロード」: その種別の公開スポット+ルートを取得して
   * IndexedDBキャッシュへ保存し(その種別の地図・一覧でもそのまま使われる)、
   * そのまま重ね表示に反映する。中断・失敗時は選択を解除する
   */
  const confirmOverlayDownload = useCallback(async () => {
    const typeKey = overlayDownloadPrompt;
    setOverlayDownloadPrompt(null);
    if (!typeKey) return;
    const controller = new AbortController();
    overlayAbortRef.current = controller;
    setOverlayDownloading(true);
    setOverlayProgress(null);
    try {
      const entry = await downloadSpotCacheFor(typeKey, controller, setOverlayProgress);
      if (!entry) {
        // キャンセル時は選択も解除する
        setOverlayTypeKey(null);
        return;
      }
      setOverlaySpots(entry.spots);
      setOverlayRoutes(entry.routes);
    } catch (err) {
      // setOverlayTypeKey(null)がoverlayMessageを消すため、メッセージは解除の後に出す
      setOverlayTypeKey(null);
      setOverlayMessage(
        `ダウンロードに失敗しました${err instanceof Error && err.message ? `: ${err.message}` : ""}`
      );
    } finally {
      overlayAbortRef.current = null;
      setOverlayDownloading(false);
      setOverlayProgress(null);
    }
  }, [overlayDownloadPrompt, setOverlayTypeKey]);

  const [loading, setLoading] = useState(true);

  const [role, setRole] = useState<Role | null>(null);
  const roleRef = useRef<Role | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    lat: number;
    lng: number;
  } | null>(null);
  const [addSpotAt, setAddSpotAt] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [pendingSpots, setPendingSpots] = useState<
    { id: string; lat: number; lng: number; name: string; status: string }[]
  >([]);
  const pendingMarkersRef = useRef<maplibregl.Marker[]>([]);

  const [showFilterModal, setShowFilterModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    { name: string; lat: number; lng: number }[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchMarkerRef = useRef<maplibregl.Marker | null>(null);
  // 検索フォーム+候補リストを囲む白い箱。候補の「外側タップで閉じる」判定に使う
  const searchBoxRef = useRef<HTMLDivElement>(null);

  // 検索候補の表示中に、検索ボックスの外(地図など)をタップしたら候補を閉じる。
  // 地図はMapLibreのcanvasでReactのクリックイベントが届かないため、documentの
  // pointerdown(capture)で拾う。検索ボックス内のタップ(入力欄の編集・再検索・
  // 候補の選択)は閉じない
  useEffect(() => {
    if (searchResults.length === 0) return;
    const onPointerDown = (e: PointerEvent) => {
      if (searchBoxRef.current?.contains(e.target as Node)) return;
      setSearchResults([]);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [searchResults.length]);

  // 初期表示の決定に使う状態。hadSavedView=この種別の表示位置を復元したか、
  // geolocateTriggered/autoFit系=初回表示の調整を一度だけ行うためのフラグ
  const geolocateRef = useRef<maplibregl.GeolocateControl | null>(null);
  const hadSavedViewRef = useRef(false);
  const geolocateTriggeredRef = useRef(false);
  const autoFitDoneRef = useRef(false);
  const worldJumpDoneRef = useRef(false);

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    api.auth.me().then(({ data }) => setRole(data?.role ?? null));
  }, []);

  // 地図の初期化
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const savedView = lastViews.get(spotTypeKey);
    hadSavedViewRef.current = !!savedView;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: osmStyle,
      center: savedView?.center ?? JAPAN_CENTER,
      zoom: savedView?.zoom ?? JAPAN_ZOOM,
      attributionControl: { compact: true },
    });
    mapReadyRef.current = false;
    pendingMapReadyRef.current = [];
    map.on("styledata", () => {
      if (mapReadyRef.current) return;
      mapReadyRef.current = true;
      const pending = pendingMapReadyRef.current;
      pendingMapReadyRef.current = [];
      for (const fn of pending) fn();
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    const geolocate = new maplibregl.GeolocateControl({
      trackUserLocation: true,
      fitBoundsOptions: { maxZoom: CURRENT_LOCATION_ZOOM },
      positionOptions: { enableHighAccuracy: true, timeout: 10000 },
    });
    map.addControl(geolocate, "top-right");
    geolocateRef.current = geolocate;
    mapRef.current = map;

    // このセッションで初めてこの種別の/mapを開いたときの初期表示調整
    // (日本の種別=現在地の自動取得、それ以外=スポット全体へのフィット)は、
    // スコープの取得完了を待つ必要があるため下の別のuseEffectで行う。
    // 他画面から戻ってきたときは直前に表示していた位置・ズームをそのまま復元し、
    // さらに離れた時点で現在地追跡モードだった場合は追跡自体を再開する
    // (trigger()はコントロールのセットアップ完了前だと無視されるため、loadを待つ)
    if (savedView && lastTrackingActive) {
      map.on("load", () => geolocateRef.current?.trigger());
    }

    // 追跡モード(カメラ追従)のON/OFFを覚えておき、次にこの画面を開いたときに復元する。
    // trackuserlocationendはOFFへの遷移だけでなくドラッグによるBACKGROUND
    // (青丸は出たままカメラ追従だけ解除)への遷移でも発火するが、どちらも
    // 「追跡モードではない」として扱う(復元したいのはカメラ追従の状態のみ)
    const handleTrackingStart = () => {
      lastTrackingActive = true;
    };
    const handleTrackingEnd = () => {
      lastTrackingActive = false;
    };
    geolocate.on("trackuserlocationstart", handleTrackingStart);
    geolocate.on("trackuserlocationend", handleTrackingEnd);
    geolocate.on("error", handleTrackingEnd);

    const saveView = () => {
      lastViews.set(spotTypeKey, {
        center: map.getCenter().toArray() as [number, number],
        zoom: map.getZoom(),
      });
    };
    map.on("moveend", saveView);

    // トラックパッドの二本指スクロールは移動、Ctrl/⌘+スクロール(ピンチ)は拡大縮小にする。
    // MapLibreのデフォルトはどちらもズーム操作になってしまうため上書きする。
    map.scrollZoom.disable();
    const container = containerRef.current;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey) {
        map.setZoom(map.getZoom() - e.deltaY * 0.01);
      } else {
        map.panBy([e.deltaX, e.deltaY], { animate: false });
      }
    };
    container.addEventListener("wheel", handleWheel, { passive: false });

    // 右クリック(PC)でスポット追加メニューを出す(ログイン中なら誰でも、非公開スポットとして
    // 追加できる)。roleがまだ分からない間は通常のブラウザメニューのままにする
    const handleContextMenu = (e: maplibregl.MapMouseEvent) => {
      if (!roleRef.current) return;
      e.originalEvent.preventDefault();
      setContextMenu({
        x: e.point.x,
        y: e.point.y,
        lat: e.lngLat.lat,
        lng: e.lngLat.lng,
      });
    };
    map.on("contextmenu", handleContextMenu);

    // 長押し(モバイル)でも同じメニューを出す
    let longPressTimer: number | null = null;
    let touchStart: { x: number; y: number } | null = null;
    const clearLongPress = () => {
      if (longPressTimer !== null) window.clearTimeout(longPressTimer);
      longPressTimer = null;
      touchStart = null;
    };
    const handleTouchStart = (e: TouchEvent) => {
      clearLongPress();
      if (e.touches.length !== 1) return;
      if (!roleRef.current) return;
      const touch = e.touches[0];
      touchStart = { x: touch.clientX, y: touch.clientY };
      longPressTimer = window.setTimeout(() => {
        if (!touchStart) return;
        const rect = container.getBoundingClientRect();
        const point: [number, number] = [
          touchStart.x - rect.left,
          touchStart.y - rect.top,
        ];
        const lngLat = map.unproject(point);
        setContextMenu({
          x: point[0],
          y: point[1],
          lat: lngLat.lat,
          lng: lngLat.lng,
        });
        touchStart = null;
      }, 550);
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (!touchStart) return;
      const touch = e.touches[0];
      const dx = touch.clientX - touchStart.x;
      const dy = touch.clientY - touchStart.y;
      if (Math.hypot(dx, dy) > 10) clearLongPress();
    };
    container.addEventListener("touchstart", handleTouchStart, { passive: true });
    container.addEventListener("touchmove", handleTouchMove, { passive: true });
    container.addEventListener("touchend", clearLongPress);
    container.addEventListener("touchcancel", clearLongPress);

    return () => {
      saveView();
      container.removeEventListener("wheel", handleWheel);
      map.off("contextmenu", handleContextMenu);
      map.off("moveend", saveView);
      geolocate.off("trackuserlocationstart", handleTrackingStart);
      geolocate.off("trackuserlocationend", handleTrackingEnd);
      geolocate.off("error", handleTrackingEnd);
      container.removeEventListener("touchstart", handleTouchStart);
      container.removeEventListener("touchmove", handleTouchMove);
      container.removeEventListener("touchend", clearLongPress);
      container.removeEventListener("touchcancel", clearLongPress);
      clearLongPress();
      searchMarkerRef.current?.remove();
      searchMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      geolocateRef.current = null;
    };
  }, [spotTypeKey]);

  // このセッションで初めてこの種別の/mapを開いたときの初期表示。スコープの取得を
  // 待ってから一度だけ行う: 日本('jp')の種別は従来どおり現在地を自動取得して
  // 周辺にズームインし、それ以外の種別は現在地ではなく登録スポット全体が入る範囲に
  // フィットする(スポットが未取得・0件の間は世界全体を表示しておく)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || regionScope === null || hadSavedViewRef.current) return;

    if (regionScope === "jp") {
      if (geolocateTriggeredRef.current) return;
      geolocateTriggeredRef.current = true;
      const trigger = () => geolocateRef.current?.trigger();
      if (map.loaded()) trigger();
      else map.on("load", trigger);
      return;
    }

    if (autoFitDoneRef.current) return;
    // /map?spot=<id> で特定スポットに飛ぶ場合は全体フィットで邪魔をしない
    if (focusSpotId) {
      autoFitDoneRef.current = true;
      return;
    }
    if (spots.length === 0) {
      if (!worldJumpDoneRef.current) {
        worldJumpDoneRef.current = true;
        map.jumpTo({ center: WORLD_CENTER, zoom: WORLD_ZOOM });
      }
      return;
    }
    autoFitDoneRef.current = true;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const s of spots) {
      if (s.lat < minLat) minLat = s.lat;
      if (s.lat > maxLat) maxLat = s.lat;
      if (s.lng < minLng) minLng = s.lng;
      if (s.lng > maxLng) maxLng = s.lng;
    }
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat],
      ],
      { padding: 60, maxZoom: 10, animate: false }
    );
  }, [regionScope, spots, focusSpotId]);

  const loadVisits = async () => {
    const { data } = await api.visits.list();
    setVisits(data ?? []);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setSearching(true);
    setSearchError(null);
    const { data, error } = await api.geocode.search(
      q,
      regionScope ?? DEFAULT_REGION_SCOPE
    );
    setSearching(false);
    if (error || !data) {
      setSearchError(error?.message ?? "検索に失敗しました");
      setSearchResults([]);
      return;
    }
    if (data.length === 0) {
      setSearchError("見つかりませんでした。");
    }
    setSearchResults(data);
  };

  const handleSelectSearchResult = (result: {
    name: string;
    lat: number;
    lng: number;
  }) => {
    const map = mapRef.current;
    if (!map) return;
    map.flyTo({ center: [result.lng, result.lat], zoom: 16 });

    searchMarkerRef.current?.remove();
    searchMarkerRef.current = new maplibregl.Marker({ color: "#dc2626" })
      .setLngLat([result.lng, result.lat])
      .setPopup(new maplibregl.Popup({ offset: 24 }).setText(result.name))
      .addTo(map)
      .togglePopup();

    setSearchResults([]);
  };

  // 公開スポットはIndexedDBの明示ダウンロードキャッシュ(spotCache)から得るため、
  // ここでは自分の非公開スポットだけをAPIから取り直す
  const loadPrivateSpots = useCallback(async () => {
    const { data } = await api.spots.list("private", { type: spotTypeKey });
    setPrivateSpots(data ?? []);
  }, [spotTypeKey]);

  // データ取得(公開スポット・公開ルートはspotCacheが読み込む)
  useEffect(() => {
    (async () => {
      await Promise.all([loadPrivateSpots(), loadVisits()]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotTypeKey]);

  // /map?spot=<id> で開かれたら、そのスポットの位置にズームする
  // (詳細モーダルは開かない: モーダルがピンの真上に重なりどこが開かれたか分からなくなるため)
  // (一覧画面の「アプリの地図で開く」から遷移してきたときなど)
  useEffect(() => {
    if (!focusSpotId || spots.length === 0) return;
    const map = mapRef.current;
    if (!map) return;
    const target = spots.find((s) => s.id === focusSpotId);
    if (!target) return;

    const fly = () => {
      map.flyTo({ center: [target.lng, target.lat], zoom: 16 });
    };
    runWhenMapReady(fly);

    // 一度処理したらURLから消す(戻る操作やスポット再取得のたびに再発火しないように)。
    // next/navigationのrouter.replaceだとuseSearchParams経由でSuspense境界が
    // 再評価され、MapView自体が再マウントされてspotsが空に戻ってしまうことが
    // あったため、ブラウザ標準のHistory APIで直接URLだけ書き換える。
    // fromは「元の地図に戻る」リンクをこの地図にいる間は出し続けたいので消さずに残す
    window.history.replaceState(
      null,
      "",
      returnTypeKey
        ? `/${spotTypeKey}/map?from=${encodeURIComponent(returnTypeKey)}`
        : `/${spotTypeKey}/map`
    );
  }, [focusSpotId, spots, spotTypeKey, returnTypeKey, runWhenMapReady]);

  // /map?filter=1 の処理。絞り込みモーダルを開き、?spot=と同様に一度処理したら
  // URLから消す(fromは「元の地図に戻る」リンクのため残す)
  useEffect(() => {
    if (!openFilterParam) return;
    setShowFilterModal(true);
    window.history.replaceState(
      null,
      "",
      returnTypeKey
        ? `/${spotTypeKey}/map?from=${encodeURIComponent(returnTypeKey)}`
        : `/${spotTypeKey}/map`
    );
  }, [openFilterParam, spotTypeKey, returnTypeKey]);

  // マーカーの生成・フィルタ反映。
  // 公開スポットも自分の非公開スポットも同じWebGLクラスタ表示で描画する
  // (非公開はピン画像を破線縁取りにして見分ける)。
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;

    // 表示対象のルート(と訪問順の経路)の経由地は、スポット自体のシリーズ・
    // カテゴリが絞り込みで外れていてもピンを表示する(別のシリーズ・カテゴリに
    // 属する経由地の上を、線だけ通ってピンが無い状態になるのを防ぐ)。
    // 免除するのはルートの表示条件と同じシリーズ・カテゴリのみで、
    // 訪問状況・訪問日の絞り込みは通常どおり適用する
    const routeMemberIds = new Set([
      ...filterVisibleRoutes(routes, filters, seriesStyles, spotById).flatMap((route) =>
        route.points.map((p) => p.spot_id)
      ),
      ...buildVisitPath(visits, filters, spotById).map((s) => s.id),
    ]);
    const filteredSpots = spots.filter(
      (spot) =>
        passesFilters(
          filters,
          spot.series,
          spot.categories,
          visitedIds.has(spot.id),
          visitedDatesBySpot.get(spot.id)
        ) ||
        (routeMemberIds.has(spot.id) &&
          passesFilters(
            { ...filters, series: [], categories: [] },
            spot.series,
            spot.categories,
            visitedIds.has(spot.id),
            visitedDatesBySpot.get(spot.id)
          ))
    );

    const renderSpots = async () => {
      ensureClusterLayers(map, setDetailSpotId);
      showClusterLayers(map);
      // 使われるピン画像(シリーズ×訪問済み×非公開)を先に登録してからデータを流し込む
      // (ラベルが画像の場合は非同期で読み込むため、全件の登録完了を待つ)
      await Promise.all(
        filteredSpots.map((spot) =>
          ensurePinImage(
            map,
            spot.series,
            visitedIds.has(spot.id),
            spot.status === "private",
            seriesStyles
          )
        )
      );
      if (cancelled) return;
      const source = map.getSource(CLUSTER_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      source?.setData(buildClusterGeoJSON(filteredSpots, visitedIds, seriesStyles));
      // 本体のレイヤーを重ね表示より後に作った場合でも、重ね表示を上に保つ
      moveOverlayLayersToTop(map);
    };
    runWhenMapReady(() => {
      renderSpots();
    });
    return () => {
      cancelled = true;
    };
  }, [
    spots,
    spotById,
    visits,
    visitedIds,
    visitedDatesBySpot,
    filters,
    runWhenMapReady,
    seriesStyles,
    routes,
  ]);

  // ルートの矢印描画。経由地2点以上のルートを、巡った順(seq昇順)に繋いだ
  // ラインと進行方向の矢印で描く。シリーズ・カテゴリ絞り込みとの連動はfilterVisibleRoutes参照。
  // 訪問日で絞り込んでいるときは、同じ見た目で自分の訪問順の経路も重ねて描く
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const visibleRoutes = filterVisibleRoutes(routes, filters, seriesStyles, spotById);
    const visitPath = buildVisitPath(visits, filters, spotById);

    runWhenMapReady(() => {
      ensureRouteLayers(map, setDetailRouteId);
      const source = map.getSource(ROUTES_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      source?.setData(
        buildRouteGeoJSON(map, visibleRoutes, seriesStyles, visitPath)
      );
    });
  }, [routes, filters, seriesStyles, runWhenMapReady, visits, spotById]);

  // 別種別の重ね表示の描画。絞り込み・経由地ピンの免除は本体と同じロジックを、
  // その種別の保存済み設定・シリーズ設定で適用する(訪問順の経路(紫)は
  // 表示中の種別の訪問だけが対象のため、重ね表示側では描かない)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;

    runWhenMapReady(() => {
      const emptyData = {
        type: "FeatureCollection",
        features: [],
      } as GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.Point>;
      if (!overlaySpots) {
        // 解除時はデータを空にする(レイヤー自体は残しても害がない)
        (map.getSource(OVERLAY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(emptyData);
        (map.getSource(OVERLAY_ROUTES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(emptyData);
        return;
      }
      const overlaySpotById = new Map(overlaySpots.map((s) => [s.id, s]));
      const visibleRoutes = filterVisibleRoutes(
        overlayRoutes,
        overlayFilters,
        overlaySeriesStyles,
        overlaySpotById
      );
      const routeMemberIds = new Set(
        visibleRoutes.flatMap((route) => route.points.map((p) => p.spot_id))
      );
      const filtered = overlaySpots.filter(
        (spot) =>
          passesFilters(
            overlayFilters,
            spot.series,
            spot.categories,
            visitedIds.has(spot.id),
            visitedDatesBySpot.get(spot.id)
          ) ||
          (routeMemberIds.has(spot.id) &&
            passesFilters(
              { ...overlayFilters, series: [], categories: [] },
              spot.series,
              spot.categories,
              visitedIds.has(spot.id),
              visitedDatesBySpot.get(spot.id)
            ))
      );

      const render = async () => {
        ensureOverlayLayers(map, setOverlayDetailSpotId, setOverlayDetailRouteId);
        // クラスタは重ね先の種別の先頭シリーズの色で塗り、本体の青いクラスタと
        // 見分けられるようにする(シリーズ設定が空の種別は未知シリーズのピンと同系のグレー)
        const clusterColor = overlaySeriesStyles[0]?.color ?? "#9ca3af";
        map.setPaintProperty(OVERLAY_CLUSTER_LAYER_ID, "circle-color", clusterColor);
        map.setPaintProperty(
          OVERLAY_CLUSTER_COUNT_LAYER_ID,
          "text-color",
          autoTextColor(clusterColor)
        );
        // キャッシュには公開スポットしか入らないため、非公開(破線)のピンは不要
        await Promise.all(
          filtered.map((spot) =>
            ensurePinImage(
              map,
              spot.series,
              visitedIds.has(spot.id),
              false,
              overlaySeriesStyles
            )
          )
        );
        if (cancelled) return;
        (map.getSource(OVERLAY_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(
          buildClusterGeoJSON(filtered, visitedIds, overlaySeriesStyles)
        );
        (map.getSource(OVERLAY_ROUTES_SOURCE_ID) as maplibregl.GeoJSONSource | undefined)?.setData(
          buildRouteGeoJSON(map, visibleRoutes, overlaySeriesStyles, [])
        );
        moveOverlayLayersToTop(map);
      };
      render();
    });
    return () => {
      cancelled = true;
    };
  }, [
    overlaySpots,
    overlayRoutes,
    overlayFilters,
    overlaySeriesStyles,
    visitedIds,
    visitedDatesBySpot,
    runWhenMapReady,
  ]);

  // 今回のセッションで送信した承認待ち/非公開スポットの仮ピン(破線)を表示
  // (通常の取得はpublishedのみなので、それ以外は一覧に反映されるまでこれで見せる)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    pendingMarkersRef.current.forEach((m) => m.remove());
    pendingMarkersRef.current = [];

    for (const p of pendingSpots) {
      const label = p.status === "private" ? "非公開" : "承認待ち";
      const color = p.status === "private" ? "#6b7280" : "#d97706";
      const el = document.createElement("div");
      el.title = `${p.name}(${label})`;
      el.style.cssText = `
        width: 16px; height: 16px; border-radius: 50%;
        background: ${color}4d; border: 2px dashed ${color};
      `;
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([p.lng, p.lat])
        .addTo(map);
      pendingMarkersRef.current.push(marker);
    }
  }, [pendingSpots]);

  // タップされたルート(絞り込み等でルート一覧が入れ替わって見つからなければ閉じる扱い)。
  // 本体・重ね表示のどちらのルートも同じ詳細モーダルで表示する(モーダル内に更新系は無い)
  const detailRoute =
    (detailRouteId ? routes.find((r) => r.id === detailRouteId) : undefined) ??
    (overlayDetailRouteId
      ? overlayRoutes.find((r) => r.id === overlayDetailRouteId)
      : undefined) ??
    null;
  const closeRouteDetail = () => {
    setDetailRouteId(null);
    setOverlayDetailRouteId(null);
  };

  // 今表示中のスポット種別の表示名(左下のチップに出す)。spotTypesは重ね表示
  // セレクト用に取得済みのものを使い回す。取得完了までは何も出さない
  // (先にキーの生文字列を出すと表示名への切り替わりがちらつくため)
  const currentTypeLabel =
    spotTypes.find((t) => t.key === spotTypeKey)?.label ?? null;
  // 「◯◯」の地図で開くで種別を切り替えて来たときの戻り先(?from=)。spotTypesに
  // 見つかる種別だけリンク化する(不正なキー・閲覧できない種別はここで弾かれる)
  const returnType =
    returnTypeKey && returnTypeKey !== spotTypeKey
      ? spotTypes.find((t) => t.key === returnTypeKey) ?? null
      : null;

  return (
    <div className="relative h-[calc(100dvh-4rem)]">
      <div ref={containerRef} className="h-full w-full" />

      {/* 今表示中のスポット種別と「元の地図に戻る」リンク(左下に小さく表示。
          attributionは右下なので重ならない)。種別チップは表示だけの要素なので、
          地図操作を吸わないようpointer-events-noneにする */}
      <div className="absolute bottom-2 left-2 z-10 flex flex-col items-start gap-1.5">
        {returnType && (
          <Link
            href={`/${returnType.key}/map`}
            className="rounded-full bg-white/85 px-2.5 py-1 text-xs font-medium text-blue-600 underline shadow"
          >
            ← 「{returnType.label}」の地図に戻る
          </Link>
        )}
        {currentTypeLabel && (
          <div className="pointer-events-none rounded-full bg-white/85 px-2.5 py-1 text-xs font-medium text-gray-700 shadow">
            {currentTypeLabel}
          </div>
        )}
      </div>

      {/* 検索バー・絞り込みボタン(右上のズーム/現在地ボタンと重ならないよう右側を開ける) */}
      <div className="absolute left-0 right-14 top-0 z-10 space-y-2 p-2">
        <div ref={searchBoxRef} className="rounded-xl bg-white/95 p-2 shadow">
          <div className="flex gap-2">
            <form onSubmit={handleSearch} className="flex min-w-0 flex-1 gap-2">
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="住所・建物名で検索"
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                disabled={searching}
                className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {searching ? "検索中…" : "検索"}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setShowFilterModal(true)}
              aria-label={filtersActive ? "絞り込み(絞り込み中)" : "絞り込み"}
              className={`shrink-0 rounded-lg border px-3 py-1.5 text-lg leading-none ${
                filtersActive
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-300 bg-white"
              }`}
            >
              ☰
            </button>
          </div>
          {searchError && (
            <p className="mt-1.5 text-xs text-red-600">{searchError}</p>
          )}
          {searchResults.length > 0 && (
            <ul className="mt-1.5 divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200">
              {searchResults.map((r, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => handleSelectSearchResult(r)}
                    className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-gray-50"
                  >
                    {r.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 絞り込みモーダル */}
      {showFilterModal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={() => setShowFilterModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold">絞り込み</h2>
              <div className="flex items-center gap-3">
                <FilterResetButton filters={filters} onChange={setFilters} />
                <button
                  type="button"
                  onClick={() => setShowFilterModal(false)}
                  aria-label="閉じる"
                  className="text-xl leading-none text-gray-400"
                >
                  ✕
                </button>
              </div>
            </div>
            <FilterBar
              spots={spots}
              filters={filters}
              onChange={setFilters}
              showReset={false}
              seriesStyles={seriesStyles}
              categories={categories}
              visitDates={visitDates}
              showRouteToggle={routes.length > 0}
            />

            {spotTypes.filter((t) => t.key !== spotTypeKey).length > 0 && (
              <div className="border-t border-gray-100 pt-3">
                <p className="mb-1 text-sm font-medium">別の種別を重ねて表示</p>
                <select
                  aria-label="重ねて表示する種別"
                  value={overlayTypeKey ?? ""}
                  onChange={(e) => setOverlayTypeKey(e.target.value || null)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="">重ねない</option>
                  {spotTypes
                    .filter((t) => t.key !== spotTypeKey)
                    .map((t) => (
                      <option key={t.key} value={t.key}>
                        {t.label}
                      </option>
                    ))}
                </select>
                {overlayMessage && (
                  <p className="mt-1 text-xs text-red-600">{overlayMessage}</p>
                )}
                <p className="mt-1 text-xs text-gray-500">
                  選んだ種別の公開スポットとルートを半透明で重ねて表示します(未ダウンロードの種別は、ダウンロードするかどうかの確認が出ます)。絞り込みとルート表示のオン/オフは、その種別の地図で自分が設定した内容に従います。
                </p>
                {overlayTypeKey &&
                  (() => {
                    // ?filter=1で遷移先の絞り込みモーダルを最初から開き、?from=で
                    // 「元の地図に戻る」リンクを出す(編集後はそこから戻ってくる。
                    // 戻ると重ね表示の絞り込みも保存済み設定から読み直される)
                    const overlayType = spotTypes.find(
                      (t) => t.key === overlayTypeKey
                    );
                    return overlayType ? (
                      <Link
                        href={`/${overlayType.key}/map?filter=1&from=${encodeURIComponent(
                          spotTypeKey
                        )}`}
                        className="mt-1.5 inline-block text-sm text-blue-600 underline"
                      >
                        「{overlayType.label}」の地図で絞り込みを編集
                      </Link>
                    ) : null;
                  })()}
              </div>
            )}

            <div className="border-t border-gray-100 pt-3">
              <p className="mb-1 text-sm font-medium">公開スポットのダウンロード</p>
              <p className="mb-2 text-xs text-gray-500">
                {spotCache.downloadedAt
                  ? `前回ダウンロード: ${formatDownloadedAt(spotCache.downloadedAt)}`
                  : "まだダウンロードしていません。"}
              </p>
              {spotCache.error && (
                <p className="mb-2 text-xs text-red-600">{spotCache.error}</p>
              )}
              <button
                type="button"
                onClick={spotCache.startManualDownload}
                disabled={spotCache.checkingSize || spotCache.downloading}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {spotCache.checkingSize
                  ? "確認中…"
                  : spotCache.downloading
                    ? "ダウンロード中…"
                    : "公開スポットをダウンロード"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    confirm(
                      "ダウンロード済みの公開スポットデータを削除しますか?次にこの画面を開いたとき、再ダウンロードが必要になります。"
                    )
                  ) {
                    spotCache.clearCache();
                  }
                }}
                disabled={
                  !spotCache.downloadedAt ||
                  spotCache.checkingSize ||
                  spotCache.downloading
                }
                className="mt-2 w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-red-600 disabled:opacity-50"
              >
                ダウンロードした公開スポットを削除
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60">
          <p className="text-sm text-gray-600">読み込み中…</p>
        </div>
      )}

      {/* 右クリック/長押しメニュー */}
      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setContextMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenu(null);
            }}
          />
          <div
            className="absolute z-40 rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              onClick={() => {
                setAddSpotAt({ lat: contextMenu.lat, lng: contextMenu.lng });
                setContextMenu(null);
              }}
              className="whitespace-nowrap px-4 py-2 text-left text-sm hover:bg-gray-50"
            >
              ここにスポットを追加
            </button>
          </div>
        </>
      )}

      {/* スポット追加モーダル */}
      {addSpotAt && (
        <AddSpotModal
          lat={addSpotAt.lat}
          lng={addSpotAt.lng}
          spotTypeKey={spotTypeKey}
          spots={spots}
          role={role}
          onClose={() => setAddSpotAt(null)}
          onSaved={(spot) => {
            if (spot.status === "private") {
              // 非公開は自分にだけ常に見えるので、通常のスポットと同じように取り直して表示する
              loadPrivateSpots();
            } else {
              setPendingSpots((prev) => [
                ...prev,
                {
                  id: spot.id,
                  lat: spot.lat,
                  lng: spot.lng,
                  name: spot.name,
                  status: spot.status,
                },
              ]);
            }
            setAddSpotAt(null);
          }}
        />
      )}

      {/* ルート詳細モーダル(ルートの線・矢印のタップで開く。重ね表示のルートも共用)。
          他のモーダルと違い常に中央表示にする(角丸画面のスマホで下端に寄せると
          端が見切れるため。中身が経由地一覧だけの小さなモーダルなので中央でも邪魔にならない) */}
      {detailRoute && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeRouteDetail}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-bold">{detailRoute.name}</h2>
              <button
                type="button"
                onClick={closeRouteDetail}
                aria-label="閉じる"
                className="text-xl leading-none text-gray-400"
              >
                ✕
              </button>
            </div>
            {detailRoute.description && (
              <p className="whitespace-pre-wrap text-sm text-gray-700">
                {detailRoute.description}
              </p>
            )}
            {detailRoute.points.length > 0 && (
              <div className="border-t border-gray-100 pt-3 text-sm">
                {/* 全経由地を巡った順に並べ、2点の間にその区間の説明(移動手段など)を挟む */}
                <ol className="space-y-0.5">
                  {detailRoute.points.map((point, i) => (
                    <li key={`${point.spot_id}-${point.seq}`}>
                      <div className="flex items-baseline gap-2">
                        <span className="w-6 shrink-0 text-right text-xs font-medium tabular-nums text-gray-500">
                          {i + 1}
                        </span>
                        {/* スポット名のタップでその位置へ飛ぶ(モーダルは閉じる) */}
                        <button
                          type="button"
                          onClick={() => {
                            closeRouteDetail();
                            mapRef.current?.flyTo({
                              center: [point.lng, point.lat],
                              zoom: 16,
                            });
                          }}
                          className="min-w-0 truncate text-left font-medium text-blue-600 underline"
                        >
                          {point.spot_name}
                        </button>
                      </div>
                      {/* 区間の説明は次の経由地との間に表示(最終地点には次の区間が無い) */}
                      {i < detailRoute.points.length - 1 && (
                        <div className="flex items-baseline gap-2 py-0.5 text-xs text-gray-500">
                          <span className="w-6 shrink-0 text-right">↓</span>
                          {point.description && (
                            <span className="min-w-0 whitespace-pre-wrap">
                              {point.description}
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
                <p className="pt-2 text-xs text-gray-500">
                  経由地{detailRoute.points.length}件。スポット名をタップすると、その位置に地図を移動します。
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 重ね表示スポットの詳細モーダル(読み取り専用。訪問記録・編集等の更新系は出さない) */}
      {overlayDetailSpotId && (
        <SpotDetailModal
          spotId={overlayDetailSpotId}
          readOnly
          onClose={() => setOverlayDetailSpotId(null)}
        />
      )}

      {/* スポット詳細モーダル */}
      {detailSpotId && (
        <SpotDetailModal
          spotId={detailSpotId}
          spots={spots}
          onClose={() => setDetailSpotId(null)}
          onVisitChange={loadVisits}
          onSpotChange={(spot) => {
            spotCache.applySpotChange(spot);
            loadPrivateSpots();
          }}
          onSpotDeleted={(id) => {
            spotCache.applySpotDelete(id);
            loadPrivateSpots();
          }}
        />
      )}

      <SpotDownloadDialogs cache={spotCache} />

      {/* 「別の種別を重ねて表示」で未ダウンロードの種別を選んだときの確認と進捗。
          絞り込みモーダル(z-50)より上に出す */}
      {overlayDownloadPrompt && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4">
            <p className="text-sm text-gray-700">
              「
              {spotTypes.find((t) => t.key === overlayDownloadPrompt)?.label ??
                overlayDownloadPrompt}
              」の公開スポットが未ダウンロードです。ダウンロードして重ねて表示しますか?
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={cancelOverlayDownloadPrompt}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={confirmOverlayDownload}
                className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white"
              >
                ダウンロード
              </button>
            </div>
          </div>
        </div>
      )}
      {overlayDownloading && (
        <DownloadProgressDialog
          progress={overlayProgress}
          onCancel={() => overlayAbortRef.current?.abort()}
        />
      )}
    </div>
  );
}
