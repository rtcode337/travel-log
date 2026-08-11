"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PlanBuildPanel from "@/components/PlanBuildPanel";
import HelpTip from "@/components/HelpTip";
import VisitPlanListFormModal from "@/components/VisitPlanListFormModal";
import { useNavVisibility } from "@/components/AppFrame";
import {
  clearPlanListDraft,
  loadPlanListDraft,
  savePlanListDraft,
  type PlanListDraft,
} from "@/lib/planListDraft";
import * as maplibregl from "@/lib/maplibre";
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
import {
  DEFAULT_REGION_SCOPE,
  resolveWikipediaLang,
  resolveWikipediaTitleSource,
} from "@/lib/region";
import { countedVisits, getSpotTypeSetting } from "@/lib/types";
import type {
  Role,
  Spot,
  SpotRoute,
  SpotType,
  Visit,
  VisitPlanList,
} from "@/lib/types";
import { expandSpot, readSpotCacheDb } from "@/lib/spotCacheDb";
import {
  autoTextColor,
  resolveSeriesStyles,
  type SeriesStyleDefinition,
} from "@/lib/seriesStyle";
import { resolveCategories } from "@/lib/category";
import { resolveSpotFace, resolveSpotMark, resolveSpotShape } from "@/lib/spotStyle";
import { formatSpotMeta } from "@/lib/spotMeta";
import { ensurePinImage, pinIconId, PIN_ICON_PAD } from "@/lib/pinIcon";
import {
  downloadSpotCacheFor,
  formatBytes,
  formatDownloadedAt,
  useSpotCache,
  type DownloadProgress,
} from "@/lib/useSpotCache";
import { useDragReorder, REORDER_HANDLE_CLASS } from "@/lib/useDragReorder";
import { useRankEnabled } from "@/lib/useRankEnabled";
import { isRank, NO_RANK, type RankFilterValue } from "@/lib/rank";
import { useSeriesStyles } from "@/lib/useSeriesStyles";
import { useCategories } from "@/lib/useCategories";
import FilterBar, {
  DEFAULT_FILTERS,
  FilterResetButton,
  formatVisitDate,
  hasActiveFilters,
  passesFilters,
  toVisitDateKey,
  type SpotFilters,
  type VisitedValue,
} from "@/components/FilterBar";
import AddSpotModal from "@/components/AddSpotModal";
import SpotDetailModal, { WikipediaIcon } from "@/components/SpotDetailModal";
import SpotInfoModal from "@/components/SpotInfoModal";
import VisitDateCalendar from "@/components/VisitDateCalendar";
import SpotDownloadDialogs, {
  DownloadProgressDialog,
} from "@/components/SpotDownloadDialogs";
import GoogleMapsRouteLink from "@/components/GoogleMapsRouteLink";
import SpotBadge from "@/components/SpotBadge";

const CLUSTER_SOURCE_ID = "spots-cluster";
const CLUSTER_LAYER_ID = "spots-clusters";
const CLUSTER_COUNT_LAYER_ID = "spots-cluster-count";
const UNCLUSTERED_LAYER_ID = "spots-unclustered-point";
/** 同じ座標に複数のスポットが重なっているピンに出す「+N」バッジ */
const STACK_BADGE_LAYER_ID = "spots-stack-badge";
/**
 * 描いている線が通るスポット専用のソース・レイヤー。**クラスタ化しない** ——
 * GeoJSONソースの`cluster`はソース単位でしか切り替えられないので、
 * まとめたくないスポットは別のソースに分ける必要がある
 */
const PATH_PIN_SOURCE_ID = "spots-path";
const PATH_PIN_LAYER_ID = "spots-path-point";
const PATH_STACK_BADGE_LAYER_ID = "spots-path-stack-badge";

const ROUTES_SOURCE_ID = "spot-routes";
const ROUTE_LINE_LAYER_ID = "spot-routes-line";
const ROUTE_ARROW_LAYER_ID = "spot-routes-arrow";
const ROUTE_HIT_LAYER_ID = "spot-routes-hit";

/**
 * 別のスポット種別を半透明で重ねて表示するためのsource/layer群(本体と独立)。
 * **複数の種別を同時に重ねられる**ため、IDは種別キーごとに作る
 */
function overlayIds(typeKey: string) {
  return {
    source: `overlay-spots:${typeKey}`,
    cluster: `overlay-clusters:${typeKey}`,
    clusterCount: `overlay-cluster-count:${typeKey}`,
    unclustered: `overlay-unclustered-point:${typeKey}`,
    routeSource: `overlay-routes:${typeKey}`,
    routeLine: `overlay-routes-line:${typeKey}`,
    routeArrow: `overlay-routes-arrow:${typeKey}`,
    routeHit: `overlay-routes-hit:${typeKey}`,
  };
}

/** 重ね表示の不透明度(本体のスポットと見分けるための半透明) */
const OVERLAY_OPACITY = 0.55;
const OVERLAY_LINE_OPACITY = 0.45;

const MAIN_PIN_LAYERS = [CLUSTER_LAYER_ID, UNCLUSTERED_LAYER_ID, PATH_PIN_LAYER_ID];

/** 指定した重ね表示種別のピン・クラスタのレイヤーID */
function overlayPinLayerIds(typeKeys: string[]): string[] {
  return typeKeys.flatMap((key) => {
    const ids = overlayIds(key);
    return [ids.cluster, ids.unclustered];
  });
}

/** 指定した重ね表示種別のルートの当たり判定レイヤーID */
function overlayRouteHitLayerIds(typeKeys: string[]): string[] {
  return typeKeys.map((key) => overlayIds(key).routeHit);
}

/**
 * レイヤー作成済みの重ね表示種別のキーを、描画順(末尾が最上位)で保持するref。
 * クリックハンドラはレイヤー作成時に一度だけ束縛されるため、そのときどきの
 * 重ね表示の状態はこのrefを通して読む
 */
type OverlayKeysRef = { current: string[] };

/**
 * 指定座標に、指定レイヤー群のいずれかの描画があるか(存在しないレイヤーは無視)。
 * タップの優先順位付けに使う: ①重ね表示のピン・クラスタ ②本体のピン・クラスタ
 * ③重ね表示のルート ④本体のルート の順で、上位が吸ったタップは下位に渡さない
 * (重ね表示同士は、描画順で上にある種別が優先する)
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

/** 描画順で`typeKey`より上に重なっている種別のキー(重ね表示中でなければ空) */
function higherOverlayKeys(keys: string[], typeKey: string): string[] {
  const index = keys.indexOf(typeKey);
  return index < 0 ? [] : keys.slice(index + 1);
}

/** ルートにシリーズが設定されていない(または種別の一覧に無い)ときの矢印色 */
const DEFAULT_ROUTE_COLOR = "#2563eb";

/**
 * 訪問順の経路(選んだ日に訪問した順)の線・矢印の色。訪問済みスポットのピン
 * (`lib/pinIcon.ts`の`visited`時の塗り)と同じ緑にして「訪問済み」を連想させる。
 */
const VISIT_PATH_COLOR = "#16a34a";

/** 訪問予定リスト(旅程)の経路の線・矢印の色。訪問順の経路(緑)・ルートと区別する紫 */
const PLAN_LIST_PATH_COLOR = "#9333ea";

/**
 * 「現在地→訪問予定リスト先頭のスポット」の区間の線・矢印の色。
 * GeolocateControlの現在地の青丸(maplibre-gl既定の.maplibregl-user-location-dot)と
 * 同じ青にして、現在地から出ている線だと分かるようにする
 */
const CURRENT_LOCATION_PATH_COLOR = "#1da1f2";

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
  overlayKeysRef: OverlayKeysRef,
  onSelectRoute: (routeId: string) => void,
  onSelectPath: (kind: "visit" | "plan", date: string | null) => void
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
        ...overlayPinLayerIds(overlayKeysRef.current),
        ...MAIN_PIN_LAYERS,
        ...overlayRouteHitLayerIds(overlayKeysRef.current),
      ])
    ) {
      return;
    }
    // ルート(routeId)を優先。無ければ訪問順の経路・訪問予定リストの経路(pathKind)
    const routeId = e.features?.find(
      (f) => typeof f.properties?.routeId === "string"
    )?.properties?.routeId;
    if (routeId) {
      onSelectRoute(routeId);
      return;
    }
    const pathFeature = e.features?.find(
      (f) =>
        f.properties?.pathKind === "visit" || f.properties?.pathKind === "plan"
    );
    const pathKind = pathFeature?.properties?.pathKind;
    if (pathKind === "visit" || pathKind === "plan") {
      // 訪問順の経路は日ごとに線が分かれているので、タップした線の日を渡す
      const pathDate = pathFeature?.properties?.pathDate;
      onSelectPath(pathKind, typeof pathDate === "string" ? pathDate : null);
    }
  });
  map.on("mouseenter", ROUTE_HIT_LAYER_ID, () => {
    map.getCanvas().style.cursor = "pointer";
  });
  map.on("mouseleave", ROUTE_HIT_LAYER_ID, () => {
    map.getCanvas().style.cursor = "";
  });
}

/**
 * 別種別の重ね表示用のsource/layerを(まだなければ)その種別のぶんだけ追加する。冪等。
 * 本体のレイヤーの上に置く(タップも重ね表示側が優先)ため、beforeIdは指定せず
 * 最上位へ追加し、以後の描画のたびにmoveOverlayLayersToTopで最上位を維持する。
 * コールバックは初回のレイヤー作成時にしか登録しないため、再レンダーで変わらない
 * 関数(setState)を渡すこと(そのときどきの重ね表示の状態はoverlayKeysRefから読む)。
 *
 * 重ねるのをやめた種別のレイヤーは削除せず、データを空にして残す
 * (重ね直しが軽く、クリックハンドラの解除も要らない。空のsourceは描画されない)
 */
function ensureOverlayLayers(
  map: maplibregl.Map,
  typeKey: string,
  overlayKeysRef: OverlayKeysRef,
  onSelectSpot: (id: string) => void,
  onSelectRoute: (routeId: string) => void
) {
  const ids = overlayIds(typeKey);
  if (map.getSource(ids.source)) return;

  // ルート(線・矢印・当たり判定)。重ね表示のピンより下になるよう先に追加する
  map.addSource(ids.routeSource, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: ids.routeLine,
    type: "line",
    source: ids.routeSource,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-width": 2.5,
      "line-opacity": OVERLAY_LINE_OPACITY,
    },
  });
  map.addLayer({
    id: ids.routeArrow,
    type: "symbol",
    source: ids.routeSource,
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
    id: ids.routeHit,
    type: "line",
    source: ids.routeSource,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-width": 22, "line-opacity": 0 },
  });

  map.addSource(ids.source, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    cluster: true,
    clusterMaxZoom: 16,
    clusterRadius: 50,
  });
  map.addLayer({
    id: ids.cluster,
    type: "circle",
    source: ids.source,
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
    id: ids.clusterCount,
    type: "symbol",
    source: ids.source,
    filter: ["has", "point_count"],
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-font": ["Noto Sans Regular"],
      "text-size": 12,
    },
    paint: { "text-color": "#ffffff", "text-opacity": 0.9 },
  });
  map.addLayer({
    id: ids.unclustered,
    type: "symbol",
    source: ids.source,
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

  map.on("click", ids.cluster, async (e) => {
    // 同じ位置で自分より上に重なっている種別のピンがあれば、そちらに譲る
    if (
      hasFeatureAt(
        map,
        e.point,
        overlayPinLayerIds(higherOverlayKeys(overlayKeysRef.current, typeKey))
      )
    ) {
      return;
    }
    const features = map.queryRenderedFeatures(e.point, {
      layers: [ids.cluster],
    });
    const clusterId = features[0]?.properties?.cluster_id;
    if (clusterId == null) return;
    const source = map.getSource(ids.source) as maplibregl.GeoJSONSource;
    const zoom = await source.getClusterExpansionZoom(clusterId);
    map.easeTo({
      center: (features[0].geometry as GeoJSON.Point).coordinates as [
        number,
        number,
      ],
      zoom,
    });
  });

  map.on("click", ids.unclustered, (e) => {
    if (
      hasFeatureAt(
        map,
        e.point,
        overlayPinLayerIds(higherOverlayKeys(overlayKeysRef.current, typeKey))
      )
    ) {
      return;
    }
    const id = e.features?.[0]?.properties?.id;
    if (id) onSelectSpot(id);
  });

  map.on("click", ids.routeHit, (e) => {
    // ピン(重ね表示・本体どちらも)と重なった位置のタップはピン側を優先し、
    // 自分より上に重なっている種別のルートがあればそちらに譲る
    if (
      hasFeatureAt(map, e.point, [
        ...overlayPinLayerIds(overlayKeysRef.current),
        ...MAIN_PIN_LAYERS,
        ...overlayRouteHitLayerIds(
          higherOverlayKeys(overlayKeysRef.current, typeKey)
        ),
      ])
    ) {
      return;
    }
    const routeId = e.features?.find(
      (f) => typeof f.properties?.routeId === "string"
    )?.properties?.routeId;
    if (routeId) onSelectRoute(routeId);
  });

  for (const layerId of [ids.cluster, ids.unclustered, ids.routeHit]) {
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
 * 「半透明の重ね表示が上・タップも重ね表示優先」を維持するため、描画のたびに呼ぶ)。
 * 複数種別を重ねているときは、まず全種別のルートを、続けて全種別のピンを
 * `typeKeys`の順で上げるため、どの種別のピンも全種別のルートより上になり、
 * 種別同士は配列の後ろにあるものほど上になる
 */
function moveOverlayLayersToTop(map: maplibregl.Map, typeKeys: string[]) {
  const idsList = typeKeys.map(overlayIds);
  const ordered = [
    ...idsList.flatMap((ids) => [ids.routeLine, ids.routeArrow, ids.routeHit]),
    ...idsList.flatMap((ids) => [ids.cluster, ids.clusterCount, ids.unclustered]),
  ];
  for (const id of ordered) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

/** 重ねるのをやめた種別のレイヤーを空にする(レイヤー自体は残す。上記ensure参照) */
function clearOverlayData(map: maplibregl.Map, typeKey: string) {
  const empty = {
    type: "FeatureCollection",
    features: [],
  } as GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.Point>;
  const ids = overlayIds(typeKey);
  (map.getSource(ids.source) as maplibregl.GeoJSONSource | undefined)?.setData(empty);
  (map.getSource(ids.routeSource) as maplibregl.GeoJSONSource | undefined)?.setData(
    empty
  );
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
 * 訪問順の経路の対象期間(`filters.visitedDate`〜`visitedDateTo`)に入る訪問か。
 * 終了日が無ければ開始日だけの単日。日付キーは`YYYY-MM-DD`なので文字列比較でよい。
 */
function isInVisitedRange(visitedOn: string | null, filters: SpotFilters): boolean {
  const from = filters.visitedDate;
  if (!from) return false;
  const key = toVisitDateKey(visitedOn);
  if (!key) return false;
  return key >= from && key <= (filters.visitedDateTo ?? from);
}

/**
 * 選んだ日(期間)に訪問したスポットのID。
 * 経路(buildVisitPath)と違い**スポットの解決が要らない**ので、まだ読み込んで
 * いないスポットや別のスポット種別のスポットも含めて「その期間に訪問したか」だけを
 * 判定できる。ピンを絞り込みから免除するかの判定はこちらを使う
 * (重ね表示側はスポットの実体を自前で持っているため、IDが分かれば足りる)。
 */
function visitedSpotIdsOn(visits: Visit[], filters: SpotFilters): Set<string> {
  if (!filters.visitedDate) return new Set();
  return new Set(
    visits
      .filter((visit) => isInVisitedRange(visit.visited_on, filters))
      .map((visit) => visit.spot_id)
  );
}

/**
 * 訪問順の経路の対象期間(`filters.visitedDate`〜`visitedDateTo`。開始日がnullなら
 * 表示しない)が選ばれているとき、その期間の訪問を**日ごとに分けて**、それぞれ
 * 訪問時刻の昇順に並べた経路を返す(日付の昇順)。
 * **日をまたいでスポットを線で結ばない** —— 宿へ帰って翌朝また出る間の移動は
 * 実際には辿っていないので、繋ぐと1日の道のりが読めなくなるため。
 * 線・詳細・Google マップの経路検索のいずれも日ごとに別のものとして扱う。
 * 別のスポット種別のスポットも、座標を補完できていれば経路に含める(訪問予定リストと
 * 同じ扱い。補完は pathExtraSpots)。解決できないスポットだけを除く。
 * 同じスポットへの再訪はそのまま複数回現れる(行って戻る線になる)が、
 * 連続する同じスポットへの訪問(同じ場所で複数回記録した場合)はまとめる
 * (長さ0の線分になり、矢印の向きが定まらないため)。
 */
function buildVisitPathsByDay(
  visits: Visit[],
  filters: SpotFilters,
  spotById: Map<string, Spot>
): { date: string; path: Spot[] }[] {
  if (!filters.visitedDate) return [];
  const byDay = new Map<string, { time: number; spot: Spot }[]>();
  for (const visit of visits) {
    if (!isInVisitedRange(visit.visited_on, filters)) continue;
    const spot = spotById.get(visit.spot_id);
    const date = toVisitDateKey(visit.visited_on);
    if (!spot || !date) continue;
    const day = byDay.get(date) ?? [];
    day.push({ time: Date.parse(visit.visited_on!), spot });
    byDay.set(date, day);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, entries]) => ({
      date,
      path: entries
        .sort((a, b) => a.time - b.time)
        .map((v) => v.spot)
        .filter((spot, i, list) => i === 0 || spot.id !== list[i - 1].id),
    }))
    .filter((day) => day.path.length > 0);
}

/**
 * routeId はタップでルート詳細を開くのに使う。訪問順の経路・訪問予定リストの経路には
 * routeId の代わりに pathKind を付け、タップで対応する経路の詳細を開く。
 * 訪問順の経路は日ごとに別の線なので、どの日の線かを pathDate(`YYYY-MM-DD`)で持ち、
 * タップしたときにその日ぶんの詳細を出せるようにする。
 */
type RouteFeatureProps = {
  color: string;
  icon: string;
  routeId?: string;
  pathKind?: "visit" | "plan";
  pathDate?: string;
};

/**
 * 選んだ訪問予定リスト(旅程)の経路。そのリストのスポットをリスト順に並べる
 * (見えないスポット=未ダウンロード等は除いて残りを繋ぐ)。
 * **訪問済みの経由スポットは経路に載せない** —— 済んだ場所を通り続ける線が
 * 残ると「次にどこへ行くか」が読めなくなるため。リスト自体からは消えないので、
 * 訪問予定リストの詳細では訪問済みとして並んだままになる。
 */
function buildPlanListPath(
  planLists: VisitPlanList[],
  filters: SpotFilters,
  spotById: Map<string, Spot>
): Spot[] {
  if (!filters.planListId) return [];
  const list = planLists.find((l) => l.id === filters.planListId);
  if (!list) return [];
  const visited = new Set(list.visited_spot_ids);
  return list.spot_ids
    .filter((id) => !visited.has(id))
    .map((id) => spotById.get(id))
    .filter((s): s is Spot => s !== undefined);
}

/**
 * ルートと、地図に重ねる色付きの経路(訪問順の経路・訪問予定リストの経路)を
 * GeoJSONのLineString群にする。矢印画像の登録もここで済ませる。
 * `start`([lng, lat])を渡した経路は、その座標からその経路の先頭までの区間を
 * `startColor`(省略時は経路と同色)の別のLineStringとして繋いで描く
 * (訪問予定リストの経路で「現在地→リスト先頭のスポット」の線を現在地の青丸と
 * 同じ色で引くのに使う。経路のスポットが1件も無いときは始点だけでは線に
 * ならないため繋がない)。
 */
function buildRouteGeoJSON(
  map: maplibregl.Map,
  routes: SpotRoute[],
  seriesStyles: SeriesStyleDefinition[],
  extraPaths: {
    path: Spot[];
    color: string;
    kind?: "visit" | "plan";
    /** 訪問順の経路で、その線がどの日のものか(`YYYY-MM-DD`) */
    date?: string;
    start?: [number, number] | null;
    startColor?: string;
  }[]
): GeoJSON.FeatureCollection<GeoJSON.LineString, RouteFeatureProps> {
  const extraFeatures: GeoJSON.Feature<GeoJSON.LineString, RouteFeatureProps>[] =
    extraPaths
      .flatMap((p) => [
        // 始点(現在地)→経路先頭の区間。色を分けられるよう独立した線にする
        ...(p.start && p.path.length > 0
          ? [
              {
                ...p,
                color: p.startColor ?? p.color,
                coordinates: [
                  p.start,
                  [p.path[0].lng, p.path[0].lat] as [number, number],
                ],
              },
            ]
          : []),
        { ...p, coordinates: p.path.map((s): [number, number] => [s.lng, s.lat]) },
      ])
      .filter((p) => p.coordinates.length >= 2)
      .map((p) => ({
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: p.coordinates,
        },
        properties: {
          color: p.color,
          icon: ensureRouteArrowImage(map, p.color),
          ...(p.kind ? { pathKind: p.kind } : {}),
          ...(p.date ? { pathDate: p.date } : {}),
        },
      }));

  return {
    type: "FeatureCollection",
    features: [
      ...extraFeatures,
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
  /** 同じ座標にあるスポットの数(1なら重なりなし)。「+N」バッジの表示に使う */
  stack: number;
};

/**
 * 同じ座標のスポットをまとめるためのキー。座標は小数第6位(約0.1m)まで見る。
 * これより粗くすると、隣接する別の建物まで同一地点にまとめてしまう
 */
function stackKey(spot: Pick<Spot, "lat" | "lng">): string {
  return `${spot.lat.toFixed(6)},${spot.lng.toFixed(6)}`;
}

/** 座標が同じスポットの件数(「+N」バッジ用)。**表示するスポット全体で数える** */
function countStacks(spots: Spot[]): Map<string, number> {
  const stacks = new Map<string, number>();
  for (const spot of spots) {
    const k = stackKey(spot);
    stacks.set(k, (stacks.get(k) ?? 0) + 1);
  }
  return stacks;
}

function buildClusterGeoJSON(
  spots: Spot[],
  visitedIds: Set<string>,
  seriesStyles: SeriesStyleDefinition[],
  rankEnabled: boolean,
  /**
   * 重なり件数。**ソースを分けても表示中の全スポットで数えたものを渡す** ——
   * 分けたあとの集合ごとに数えると、経路上のピンと重なっている普通のピンが
   * 「+N」に出てこなくなる(クラスタが解けた拡大率では完全に重なるので、
   * 数が出ないと下のピンの存在に気づけない)
   */
  stacks: Map<string, number>
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
          resolveSpotFace(spot.rank, spot.series, seriesStyles, rankEnabled),
          resolveSpotMark(spot.series, seriesStyles),
          resolveSpotShape(spot.series, seriesStyles),
          visitedIds.has(spot.id),
          spot.status === "private"
        ),
        stack: stacks.get(stackKey(spot)) ?? 1,
      },
    })),
  };
}

/**
 * ピンと「+N」バッジのレイヤーを、指定のソースに同じ見た目で足す。
 * クラスタ用(`clustered`)は集約された点を除く filter が要る一方、
 * 経路用のソースには集約が無いので filter を付けない。
 * **2つのソースで見た目が割れないよう、レイアウトはここ1か所に置く。**
 */
function addPinLayers(
  map: maplibregl.Map,
  sourceId: string,
  pinLayerId: string,
  badgeLayerId: string,
  clustered: boolean
) {
  const notCluster: maplibregl.FilterSpecification = ["!", ["has", "point_count"]];
  map.addLayer({
    id: pinLayerId,
    type: "symbol",
    source: sourceId,
    ...(clustered ? { filter: notCluster } : {}),
    layout: {
      "icon-image": ["get", "icon"],
      "icon-anchor": "bottom",
      // 画像下端の影用余白の分だけ押し下げ、とんがりの先端を座標に一致させる
      "icon-offset": [0, PIN_ICON_PAD],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
    },
  });

  // 座標が同じスポットが2件以上あるピンの右肩に「+N」(Nは隠れている件数)を出す。
  // これが無いと、下に重なっているスポットの存在に気づけない
  const stacked: maplibregl.FilterSpecification = [">", ["get", "stack"], 1];
  map.addLayer({
    id: badgeLayerId,
    type: "symbol",
    source: sourceId,
    filter: clustered ? ["all", notCluster, stacked] : stacked,
    layout: {
      "text-field": ["concat", "+", ["to-string", ["-", ["get", "stack"], 1]]],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-anchor": "bottom",
      "text-offset": [1.3, -1.6],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "#1f2937",
      "text-halo-width": 2,
    },
  });
}

/** クラスタ用のsource/layerを(まだなければ)追加する。冪等 */
function ensureClusterLayers(
  map: maplibregl.Map,
  overlayKeysRef: OverlayKeysRef,
  /** 押されたピンのID(同じ地点に何件あるかは呼び出し側が解決する) */
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
  // とんがりの先端がスポットの座標を指すようにicon-anchorはbottomにする。
  // **クラスタ用と経路用の2つのソースに同じ見た目で載せる**(addPinLayers)
  addPinLayers(map, CLUSTER_SOURCE_ID, UNCLUSTERED_LAYER_ID, STACK_BADGE_LAYER_ID, true);

  // 描いている線が通るスポットは、クラスタ化しない別ソースに載せる
  map.addSource(PATH_PIN_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  addPinLayers(
    map,
    PATH_PIN_SOURCE_ID,
    PATH_PIN_LAYER_ID,
    PATH_STACK_BADGE_LAYER_ID,
    false
  );

  map.on("click", CLUSTER_LAYER_ID, async (e) => {
    // 重ね表示のピン・クラスタと重なった位置のタップは重ね表示側が吸う
    if (hasFeatureAt(map, e.point, overlayPinLayerIds(overlayKeysRef.current)))
      return;
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

  // ピンのタップ。**クラスタ用と経路用の両方のレイヤーに同じ処理を付ける**
  // ピンと「+N」バッジのタップ。**押されたピンの座標をそのまま渡す** ——
  // 同じ地点に何件あるかの解決は呼び出し側(表示中のスポットを持っている側)に任せる。
  // ここで`queryRenderedFeatures`から拾うと**描かれているピンしか数えられず**、
  // 拡大率が低いときに相方がクラスタへ吸われていると「+N」と食い違う
  // (Nは表示中の全スポットで数えているため)。
  // バッジにも同じ処理を付ける —— 「+N」の文字はピンの右肩にずらして描くので、
  // そこを押すとピンの当たり判定から外れることがある
  for (const layerId of [
    UNCLUSTERED_LAYER_ID,
    PATH_PIN_LAYER_ID,
    STACK_BADGE_LAYER_ID,
    PATH_STACK_BADGE_LAYER_ID,
  ]) {
    map.on("click", layerId, (e) => {
      // 重ね表示のピン・クラスタと重なった位置のタップは重ね表示側が吸う
      if (hasFeatureAt(map, e.point, overlayPinLayerIds(overlayKeysRef.current)))
        return;
      // **座標はフィーチャから読まない。** GeoJSONソースは内部でタイルに
      // 変換されるので、返ってくる座標は拡大率に応じて丸められている
      // (低い拡大率では数十m単位)。同じ地点の判定に使うと一致しなくなるため、
      // IDだけ渡して呼び出し側が元のスポットの座標で引き直す
      const id = e.features?.[0]?.properties?.id;
      if (typeof id !== "string") return;
      onSelectSpot(id);
    });
  }

  for (const layerId of [CLUSTER_LAYER_ID, UNCLUSTERED_LAYER_ID, PATH_PIN_LAYER_ID]) {
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
    STACK_BADGE_LAYER_ID,
    PATH_PIN_LAYER_ID,
    PATH_STACK_BADGE_LAYER_ID,
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

/** 今日のローカル日付(`YYYY-MM-DD`)。訪問順の経路の既定対象日に使う */
function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 訪問順の経路の対象日を既定(今日)にした絞り込み条件 */
function defaultMapFilters(): SpotFilters {
  return { ...DEFAULT_FILTERS, visitedDate: todayKey() };
}

/**
 * 実際に効かせる「これだけを表示」。対象(訪問日 / 訪問予定リスト)が選ばれていない
 * isolateは無視して通常表示に戻す(選択を「表示しない」に変えたのに何も出ない状態を防ぐ)。
 */
function effectiveIsolate(filters: SpotFilters): "visit" | "plan" | null {
  if (filters.isolate === "visit") return filters.visitedDate ? "visit" : null;
  if (filters.isolate === "plan") return filters.planListId ? "plan" : null;
  return null;
}

/**
 * 保存済みの絞り込み条件を読む。未保存・不正値は既定(訪問順の経路=今日)を返す。
 * `visitedDate`は絞り込みではなく訪問順の経路の対象日で、既定は今日。「表示しない」は
 * 保存時に文字列`"none"`で書く(下記`saveFilters`)ため、`"none"`のときだけnull=表示
 * しないにする。「今日」は`"today"`で保存されるので、読み込み時のその日の`todayKey()`に
 * 解決する(日付を固定しないので、翌日に開いてもその日が今日として選ばれる)。旧仕様の
 * 保存値(絞り込みだった頃のnull・日付、キー欠落)は「明示的な表示しない」ではないので
 * 今日に倒す(既存ユーザーも初回から今日の経路が出る)。
 */
function loadSavedFilters(typeKey: string): SpotFilters {
  if (typeof localStorage === "undefined") return defaultMapFilters();
  try {
    const raw = localStorage.getItem(FILTERS_STORAGE_PREFIX + typeKey);
    if (!raw) return defaultMapFilters();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return defaultMapFilters();
    const obj = parsed as Record<string, unknown>;
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    // 訪問日は`YYYY-MM-DD`のみ受け付ける
    const date = (v: unknown): string | null =>
      typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
    const visited = strings(obj.visited).filter(
      (v): v is VisitedValue => v === "visited" || v === "unvisited"
    );
    return {
      // ランクの保存値。A〜Eと"none"(ランクなし)以外は捨てる
      // (キー欠落=この項目より前の保存データは絞り込みなし)
      ranks: strings(obj.ranks).filter((v): v is RankFilterValue =>
        v === NO_RANK || isRank(v)
      ),
      series: strings(obj.series),
      categories: strings(obj.categories),
      // **空配列は「すべて」として保存された値**なのでそのまま使う。
      // キー自体が無いとき(この項目より前の保存データ)だけ既定=未訪問のみに倒す
      // —— 空を既定へ倒すと、「すべて」を選んで地図を開き直すたびに未訪問へ戻る
      visited: Array.isArray(obj.visited) ? visited : [...DEFAULT_FILTERS.visited],
      // "none"=表示しない、"today"=(その日ではなく)常に今日、日付=その日、
      // それ以外(旧null・キー欠落など)=今日
      visitedDate:
        obj.visitedDate === "none"
          ? null
          : obj.visitedDate === "today"
            ? todayKey()
            : date(obj.visitedDate) ?? todayKey(),
      // 期間の終了日。キー欠落(この項目より前の保存データ)・不正値は単日扱い。
      // 「今日」のような相対表現は持たない —— 終了日だけ動くと期間の長さが
      // 日をまたぐたびに変わってしまうため、具体的な日付でだけ保存する
      visitedDateTo: date(obj.visitedDateTo),
      // 訪問予定リストの経路対象(そのリストが今も存在するかは描画側で解決する)
      planListId: typeof obj.planListId === "string" ? obj.planListId : null,
      // キー自体が無い保存データ(この設定の追加前に保存されたもの)は既定のオン扱い
      showRoutes: typeof obj.showRoutes === "boolean" ? obj.showRoutes : true,
      disableCluster:
        typeof obj.disableCluster === "boolean" ? obj.disableCluster : false,
      // 「これだけを表示」は一時的な注視モードのため復元しない(開き直しで地図が
      // 1経路だけに絞られたまま=ほぼ空、という分かりにくい状態を避ける)
      isolate: null,
    };
  } catch {
    return defaultMapFilters();
  }
}

function saveFilters(typeKey: string, filters: SpotFilters) {
  try {
    // visitedDate の保存表現:
    // - null(表示しない) → "none"(旧仕様の「絞り込みなしのnull」と区別。loadSavedFilters参照)
    // - 今日(todayKey()と一致) → "today"(具体的な日付ではなく「今日」の意図で保存する。
    //   でないと日付が固定され、翌日に前日が選ばれた状態で復元されてしまう。「今日」は
    //   セレクトの選択肢として today のみで、others からは today を除いているため、
    //   visitedDate が todayKey() と一致するのは「今日」を選んだときだけと判断できる)
    // - それ以外の具体的な日付 → その日付をそのまま保存
    const storedVisitedDate =
      filters.visitedDate == null
        ? "none"
        : filters.visitedDate === todayKey()
          ? "today"
          : filters.visitedDate;
    const stored = { ...filters, visitedDate: storedVisitedDate };
    localStorage.setItem(FILTERS_STORAGE_PREFIX + typeKey, JSON.stringify(stored));
  } catch {
    // プライベートブラウズ等で保存できなくても絞り込み自体は動かす
  }
}

/**
 * 重ね表示する種別の選択も、絞り込み条件と同様に(表示中の)種別ごとに保存・復元する。
 * 複数種別を重ねられるようにしたため、値はキーのJSON配列(選んだ順=描画順)で保存する。
 * 単一種別しか重ねられなかった頃の保存値(生のキー1つ)も読めるようにしてある
 */
const OVERLAY_STORAGE_PREFIX = "travel-log:map-overlay:";

function loadSavedOverlayTypeKeys(typeKey: string): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(OVERLAY_STORAGE_PREFIX + typeKey);
    if (!raw) return [];
    let keys: string[];
    try {
      const parsed: unknown = JSON.parse(raw);
      keys = Array.isArray(parsed)
        ? parsed.filter((v): v is string => typeof v === "string")
        : // JSONとして読めるが配列でない値(旧形式でキーが数字だった等)は単一指定扱い
          [raw];
    } catch {
      // 旧形式(キーをそのまま保存していた頃)
      keys = [raw];
    }
    // 自分自身を重ねる設定・重複は不正値として無視する
    return keys.filter((k, i) => k !== typeKey && keys.indexOf(k) === i);
  } catch {
    return [];
  }
}

function saveOverlayTypeKeys(typeKey: string, overlays: string[]) {
  try {
    if (overlays.length > 0) {
      localStorage.setItem(
        OVERLAY_STORAGE_PREFIX + typeKey,
        JSON.stringify(overlays)
      );
    } else {
      localStorage.removeItem(OVERLAY_STORAGE_PREFIX + typeKey);
    }
  } catch {
    // 保存できなくてもこのセッションの重ね表示自体は動かす
  }
}

/** カレンダーのアイコン(Google Material Symbols「calendar_month」、Apache License 2.0) */
function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M5 22q-.825 0-1.412-.587Q3 20.825 3 20V6q0-.825.588-1.412Q4.175 4 5 4h1V2h2v2h8V2h2v2h1q.825 0 1.413.588Q21 5.175 21 6v14q0 .825-.587 1.413Q19.825 22 19 22Zm0-2h14V10H5v10ZM5 8h14V6H5Zm0 0V6v2Zm7 6q-.425 0-.712-.288Q11 13.425 11 13t.288-.713Q11.575 12 12 12t.713.287Q13 12.575 13 13t-.287.712Q12.425 14 12 14Zm-4 0q-.425 0-.713-.288Q7 13.425 7 13t.287-.713Q7.575 12 8 12t.713.287Q9 12.575 9 13t-.287.712Q8.425 14 8 14Zm8 0q-.425 0-.712-.288Q15 13.425 15 13t.288-.713Q15.575 12 16 12t.712.287Q17 12.575 17 13t-.288.712Q16.425 14 16 14Zm-4 4q-.425 0-.712-.288Q11 17.425 11 17t.288-.712Q11.575 16 12 16t.713.288Q13 16.575 13 17t-.287.712Q12.425 18 12 18Zm-4 0q-.425 0-.713-.288Q7 17.425 7 17t.287-.712Q7.575 16 8 16t.713.288Q9 16.575 9 17t-.287.712Q8.425 18 8 18Zm8 0q-.425 0-.712-.288Q15 17.425 15 17t.288-.712Q15.575 16 16 16t.712.288Q17 16.575 17 17t-.288.712Q16.425 18 16 18Z" />
    </svg>
  );
}

/**
 * 絞り込みモーダルの各セクション(訪問日・訪問予定リスト・別の種別を重ねて表示)
 * ごとの小さなリセットボタン。見出し行のリセット(絞り込みのみを戻す)とは独立に、
 * そのセクションの選択だけを既定へ戻す。「これだけを表示」ボタンと同じ大きさで、
 * 戻す対象があるときだけ青にする
 */
function SectionResetButton({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
        disabled
          ? "border-gray-300 bg-white text-gray-400"
          : "border-blue-600 bg-blue-600 text-white"
      }`}
    >
      リセット
    </button>
  );
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusSpotId = searchParams.get("spot");
  // /map?buildList=1 で開かれたら、訪問予定リスト作成モードに入る(下書きをlocalStorageから読む)
  const buildListParam = searchParams.get("buildList");
  // 「◯◯」の地図で開くリンク(重ね表示のスポット詳細)で種別を切り替えて来たとき、
  // 元の種別のキーがfromに入る。左下に「元の地図に戻る」リンクを出すのに使う
  // (戻り先の表示位置は種別ごとのlastViewsが復元するため、キーだけあればよい)
  const returnTypeKey = searchParams.get("from");
  // /map?filter=1 で開かれたら絞り込みモーダルを最初から開く(直リンク用に残す。
  // 重ね表示側の絞り込みは種別を切り替えず現在の地図の上のモーダルで編集するため、
  // アプリ内からこのパラメータ付きで遷移する箇所は現在はない)
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
  // カテゴリごとのピンの形。設定が無い種別では空配列(=すべて既定の丸)
  const rankEnabled = useRankEnabled(spotTypeKey);
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
  // 訪問予定リスト(絞り込みモーダルの「訪問予定リスト」セレクトで経路表示に使う)
  const [planLists, setPlanLists] = useState<VisitPlanList[]>([]);
  // 自分が非表示にしたスポットのID(公開スポットをユーザーごとに地図・一覧から隠す設定。
  // スポットのIDで引くため種別をまたいで共通に効き、重ね表示側にも同じ集合を適用する)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  // 現在地(GeolocateControlの青丸)の最新座標([lng, lat])。青丸の表示中だけ持ち
  // (青丸ごと消えるOFFでnullに戻す)、訪問予定リストの経路表示で
  // 「現在地→リスト先頭のスポット」の線を引くのに使う
  const [currentLocation, setCurrentLocation] = useState<
    [number, number] | null
  >(null);
  // 経路表示の対象(訪問予定リスト・選んだ日の訪問)に、本体種別に無いスポット
  // (別スポット種別のもの)があるとき、その座標を api.spots.get で補完して経路に
  // 含める。resolvedRefで再取得を防ぐ
  const [pathExtraSpots, setPathExtraSpots] = useState<Map<string, Spot>>(
    new Map()
  );
  const pathResolvedRef = useRef<Set<string>>(new Set());
  // 訪問済み(ピンの緑色・訪問状況の絞り込み)には未訪問記録(unvisited)を数えない。
  // 訪問順の経路(buildVisitPath)・訪問日の選択肢は日時ありの未訪問記録も含むため、
  // そちらはvisitsをそのまま使う
  const visitedIds = useMemo(
    () => new Set(countedVisits(visits).map((v) => v.spot_id)),
    [visits]
  );
  const spotById = useMemo(() => {
    const m = new Map<string, Spot>();
    for (const s of spots) m.set(s.id, s);
    return m;
  }, [spots]);
  // 経路(訪問順・訪問予定リスト)を組むときのスポット解決用。本体スポットに、
  // 別種別スポットの補完(pathExtraSpots)を足す。
  // 補完が無いときは spotById をそのまま使う(参照維持)
  const pathSpotById = useMemo(() => {
    if (pathExtraSpots.size === 0) return spotById;
    return new Map([...spotById, ...pathExtraSpots]);
  }, [spotById, pathExtraSpots]);
  /**
   * 訪問記録のある日。カレンダーで「その日に記録があるか」の印(点)を打つのに使う。
   * **他の種別のスポットへの訪問も含める** —— 経路は別種別のスポットも
   * 補完して繋ぐようになったので、その日を落とすと辿れないため。
   */
  const visitDateSet = useMemo(() => {
    const set = new Set<string>();
    for (const v of visits) {
      const date = toVisitDateKey(v.visited_on);
      if (date) set.add(date);
    }
    return set;
  }, [visits]);
  // SSR・hydration時は常に既定(サーバーはlocalStorageを読めないため、初期値で
  // 読むとhydration不一致になる)。保存済み条件の復元はマウント後のuseEffectで行う
  const [filters, setFiltersState] = useState<SpotFilters>(DEFAULT_FILTERS);
  /**
   * カレンダーとリセットが基準にする「今日」。マウント後に一度だけ決める
   * (レンダーのたびに`todayKey()`を呼ぶと日をまたいだ瞬間に値が変わりうるため)。
   */
  const visitDateOptions = useMemo(() => ({ today: todayKey() }), []);
  // 変更のたびにlocalStorageへも書き込む(次に地図を開いたときの復元用)
  const setFilters = useCallback(
    (next: SpotFilters) => {
      saveFilters(spotTypeKey, next);
      setFiltersState(next);
    },
    [spotTypeKey]
  );
  // 訪問日セレクトで日を選んだとき。対象日をセットしたうえで、その日の訪問順の経路
  // 全体が画面に収まるよう地図を移動する(「表示しない」やその日の訪問が無い場合は
  // 対象日を変えるだけで地図は動かさない)。ユーザーが明示的に選んだときだけ動かすため、
  // マウント時の既定(今日)の復元では走らせず、この選択ハンドラでのみ行う
  // 経路(スポット列)全体が画面に収まるよう地図を移動する。モーダルを開いたまま
  // 選ぶ想定だが、地図は全画面なので閉じたときに経路全体が中央に収まる
  const fitMapToSpots = useCallback((path: Spot[]) => {
    const map = mapRef.current;
    if (!map || path.length === 0) return;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLng = Infinity;
    let maxLng = -Infinity;
    for (const s of path) {
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
      // 1地点だけのときはmaxZoomまで寄る
      { padding: 60, maxZoom: 15, animate: true }
    );
  }, []);
  /**
   * 訪問順の経路の対象日(期間)を選んだとき。対象をセットしたうえで、その経路
   * 全体が画面に収まるよう地図を移動する。`from`がnullなら「表示しない」。
   */
  const handleSelectVisitDate = useCallback(
    (from: string | null, to: string | null) => {
      // 「表示しない」にしたら、その経路の「これだけを表示」も解除する
      const isolate = !from && filters.isolate === "visit" ? null : filters.isolate;
      const next = {
        ...filters,
        visitedDate: from,
        // 開始日が無いときに終了日だけ残ると、次に日を選んだとき意図しない期間に
        // なるため一緒に落とす
        visitedDateTo: from ? to : null,
        isolate,
      };
      setFilters(next);
      if (!from) return;
      // 別種別のスポットは、この時点ではまだ補完(pathExtraSpots)が済んで
      // いないことがある。その場合は解決できた分だけで移動し、補完が届いたあとの
      // 経路の描き直しに合わせて地図を動かし直すことはしない
      // (ユーザーの操作なしに地図が動くのを避けるため)
      fitMapToSpots(
        buildVisitPathsByDay(visits, next, pathSpotById).flatMap((d) => d.path)
      );
    },
    [filters, setFilters, visits, pathSpotById, fitMapToSpots]
  );
  // 訪問予定リストを選んだとき。そのリストのスポットをリスト順に経路表示し、
  // 経路全体が画面に収まるよう地図を移動する(「表示しない」時は移動しない)
  const handleSelectPlanList = useCallback(
    (value: string) => {
      const planListId = value || null;
      // 「表示しない」にしたら、その経路の「これだけを表示」も解除する
      const isolate =
        !planListId && filters.isolate === "plan" ? null : filters.isolate;
      setFilters({ ...filters, planListId, isolate });
      if (!planListId) return;
      fitMapToSpots(
        buildPlanListPath(planLists, { ...filters, planListId }, pathSpotById)
      );
    },
    [filters, setFilters, planLists, pathSpotById, fitMapToSpots]
  );

  // マウント時と、マウント中に種別が切り替わった場合に、その種別の保存済み条件を読む
  useEffect(() => {
    setFiltersState(loadSavedFilters(spotTypeKey));
  }, [spotTypeKey]);
  // 何らかの絞り込みが掛かっているか(絞り込みボタンの見た目に使う。ルート表示のオン/オフは含めない)
  const filtersActive = hasActiveFilters(filters);
  const [detailSpotId, setDetailSpotId] = useState<string | null>(null);
  /** 同じ地点に重なっているスポットの選択一覧(nullなら非表示) */
  const [stackSpotIds, setStackSpotIds] = useState<string[] | null>(null);
  /** いま地図に出しているスポット(絞り込み後)。ピンのタップ処理は地図の
   *  レイヤー生成時に一度だけ束縛されるので、最新の一覧はrefで参照する */
  const displayedSpotsRef = useRef<Spot[]>([]);
  // タップされたルート(ルート詳細モーダルの表示対象)
  const [detailRouteId, setDetailRouteId] = useState<string | null>(null);
  // 訪問順の経路(緑)・訪問予定リストの経路(紫)の線をタップしたときに開く詳細の対象
  const [detailPathKind, setDetailPathKind] = useState<"visit" | "plan" | null>(
    null
  );
  // 訪問順の経路は日ごとに線が分かれるため、詳細を開いた線がどの日かを覚える
  const [detailPathDate, setDetailPathDate] = useState<string | null>(null);
  // 経路詳細の「編集」で開く訪問予定リストの基本情報編集モーダルの対象
  const [editingPlanList, setEditingPlanList] = useState<VisitPlanList | null>(
    null
  );
  // 今の訪問予定リスト作成/編集が、地図の経路詳細「編集」から始まったか。
  // true なら完了・キャンセル時に一覧(/spots)ではなく地図へ戻す
  const buildFromMapRef = useRef(false);
  // ルート・経路の詳細は同じモーダルで出す。どれか1つだけ開くよう、開くとき他を閉じる
  const openRouteDetail = useCallback((routeId: string) => {
    setDetailPathKind(null);
    setOverlayDetailRouteId(null);
    setDetailRouteId(routeId);
  }, []);
  const openPathDetail = useCallback((kind: "visit" | "plan", date: string | null) => {
    setDetailPathDate(date);
    setDetailRouteId(null);
    setOverlayDetailRouteId(null);
    setDetailPathKind(kind);
  }, []);

  // 訪問予定リスト作成モード。buildDraftがあるとき作成モード。addCandidateは
  // ピンをタップして「リストに追加しますか?」を確認中のスポットID
  const [buildDraft, setBuildDraft] = useState<PlanListDraft | null>(null);
  const [addCandidate, setAddCandidate] = useState<string | null>(null);
  // 追加の確認中に開くWikipediaの概要(SpotInfoModal)。確認ダイアログを閉じるときに
  // 一緒に閉じるため、対象は addCandidate 側に持たせず真偽値だけを持つ
  const [addCandidateInfo, setAddCandidateInfo] = useState(false);
  const [savingList, setSavingList] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  // ピンのクリックハンドラ(レイヤー作成時に一度だけ束縛される)から現在の作成モードを
  // 参照するためのref。作成モード中はピンタップを詳細表示でなくリスト追加に回す
  const buildModeRef = useRef(false);
  // 作成モードに入った時点でスポットのある下書き(既存リストの編集など)は、
  // その経路全体が見えるようスポット読み込み後に一度だけfitBoundsする
  const buildFitPendingRef = useRef(false);
  // 作成中は下タブ(NavBar)を隠して、別タブへ移動して入力中の内容を失うのを防ぐ
  const { setHideNav } = useNavVisibility();
  useEffect(() => {
    buildModeRef.current = buildDraft !== null;
    setHideNav(buildDraft !== null);
    return () => setHideNav(false);
  }, [buildDraft, setHideNav]);
  // マウント時/種別切替時に ?buildList=1 なら下書きを読み込んで作成モードに入る
  useEffect(() => {
    if (buildListParam === "1") {
      const draft = loadPlanListDraft(spotTypeKey);
      setBuildDraft(draft);
      buildFitPendingRef.current = (draft?.spotIds.length ?? 0) > 0;
      // 経路詳細の「編集」から来た場合、基本情報モーダルは閉じて地図の作成モードに移る
      // (同一ページ遷移のため自動では閉じない。SpotsView からの遷移では unmount で消える)
      setEditingPlanList(null);
      // スポット詳細の「訪問予定リストへ追加」→「新しいリストを作成」から来た場合も
      // 同じく同一ページ遷移のため、スポット詳細(とその中の追加モーダル・基本情報
      // フォーム)を明示的に閉じる。重ね表示スポットの詳細からも同じ操作ができる
      setDetailSpotId(null);
      setOverlayDetailSpotId(null);
    }
  }, [buildListParam, spotTypeKey]);

  // 経路表示中のリスト・作成モード中の下書き・選んだ日の訪問に、本体種別で解決
  // できないスポット(別のスポット種別のもの)があれば、api.spots.get で座標を
  // 補完する(経路線から抜けないように)
  useEffect(() => {
    const list = filters.planListId
      ? planLists.find((l) => l.id === filters.planListId)
      : undefined;
    const targetIds = new Set([
      ...(list?.spot_ids ?? []),
      ...(buildDraft?.spotIds ?? []),
      // 選んだ日に訪問したスポット。別種別のものも訪問順の経路に含めるため、
      // 訪問予定リストと同じく補完の対象にする
      ...visitedSpotIdsOn(visits, filters),
    ]);
    const missing = [...targetIds].filter(
      (id) => !spotById.has(id) && !pathResolvedRef.current.has(id)
    );
    if (missing.length === 0) return;
    // 二重取得を防ぐため先に予約する。取得結果は id をキーにした追記のみの解決
    // キャッシュに足すだけなので、この effect が(リスト変更などで)途中で作り直されても
    // 破棄しない。破棄すると予約だけ残って経路からスポットが抜けたままになる
    missing.forEach((id) => pathResolvedRef.current.add(id));
    Promise.all(missing.map((id) => api.spots.get(id))).then((results) => {
      const fetched = results
        .map((r) => r.data)
        .filter((s): s is Spot => s != null);
      // 取得できなかった id は予約を外し、次に条件が変わったとき再取得できるようにする
      const fetchedIds = new Set(fetched.map((s) => s.id));
      for (const id of missing) {
        if (!fetchedIds.has(id)) pathResolvedRef.current.delete(id);
      }
      if (fetched.length === 0) return;
      setPathExtraSpots((prev) => {
        const next = new Map(prev);
        for (const s of fetched) next.set(s.id, s);
        return next;
      });
    });
    // filters は visitedDate / planListId しか見ないが、両方を含む filters を
    // そのまま渡している(visitedSpotIdsOn が filters を受け取るため)
  }, [filters, planLists, spotById, buildDraft, visits]);

  // ピンのタップ: 作成モード中は追加確認へ、それ以外は従来どおり詳細表示へ
  const handleSpotSelect = useCallback((id: string) => {
    if (buildModeRef.current) setAddCandidate(id);
    else setDetailSpotId(id);
  }, []);

  /**
   * 地図でピン(または「+N」バッジ)を押したとき。**同じ座標のスポットは
   * 表示中の全件から引き直す** —— 描かれているピンだけを見ると、拡大率が低くて
   * 相方がクラスタに吸われているときに1件しか見つからず、「+N」と食い違う。
   * 2件以上あれば、どれを開くかを選ばせる(上のピンだけ開くと下は永久に開けない)
   */
  const handleMapSpotSelect = useCallback(
    (id: string) => {
      // 押されたスポット**自身の座標**で引き直す(地図から渡ってくる座標は
      // タイル化で丸められていて、同じ地点の判定には使えない)
      const shown = displayedSpotsRef.current;
      const clicked = shown.find((spot) => spot.id === id);
      const ids = clicked
        ? shown.filter((spot) => stackKey(spot) === stackKey(clicked)).map((s) => s.id)
        : [id];
      if (ids.length > 1) setStackSpotIds(ids);
      else handleSpotSelect(id);
    },
    [handleSpotSelect]
  );

  const updateBuildDraft = useCallback(
    (next: PlanListDraft) => {
      setBuildDraft(next);
      savePlanListDraft(spotTypeKey, next);
    },
    [spotTypeKey]
  );
  const completeBuild = useCallback(async () => {
    if (!buildDraft) return;
    setSavingList(true);
    setBuildError(null);
    // 編集中(editingIdあり)はPATCHで更新、新規はPOSTで作成
    const { error } = buildDraft.editingId
      ? await api.visitPlanLists.update(buildDraft.editingId, {
          title: buildDraft.title,
          description: buildDraft.description,
          start_date: buildDraft.start_date,
          end_date: buildDraft.end_date,
          spot_ids: buildDraft.spotIds,
        })
      : await api.visitPlanLists.create({
          type: spotTypeKey,
          title: buildDraft.title,
          description: buildDraft.description,
          start_date: buildDraft.start_date,
          end_date: buildDraft.end_date,
          spot_ids: buildDraft.spotIds,
        });
    setSavingList(false);
    if (error) {
      setBuildError("保存に失敗しました: " + error.message);
      return;
    }
    clearPlanListDraft(spotTypeKey);
    setBuildDraft(null);
    // 地図の経路詳細から来た編集は、一覧ではなく地図へ戻す。編集を経路(紫)へ即反映
    // したいので、リストを取り直してから ?buildList=1 を落とした地図に戻る
    if (buildFromMapRef.current) {
      buildFromMapRef.current = false;
      const { data } = await api.visitPlanLists.list(spotTypeKey);
      setPlanLists(data ?? []);
      router.replace(`/${spotTypeKey}/map`);
      return;
    }
    router.push(`/${spotTypeKey}/spots`);
  }, [buildDraft, spotTypeKey, router]);
  const cancelBuild = useCallback(() => {
    clearPlanListDraft(spotTypeKey);
    setBuildDraft(null);
    setAddCandidate(null);
    // 地図の経路詳細から来た編集のキャンセルは、一覧ではなく地図へ戻す
    if (buildFromMapRef.current) {
      buildFromMapRef.current = false;
      router.replace(`/${spotTypeKey}/map`);
      return;
    }
    router.push(`/${spotTypeKey}/spots`);
  }, [spotTypeKey, router]);

  // 別種別の重ね表示(**複数の種別を同時に重ねられる**)。選択種別はこの種別の
  // 設定としてlocalStorageへ保存し、スポットはその種別のダウンロード済みキャッシュ
  // (IndexedDB)から読む。絞り込み・ルート表示のオン/オフは種別ごとに、その種別の
  // 地図で自分が保存した設定に従う
  const [overlayTypeKeys, setOverlayTypeKeysState] = useState<string[]>([]);
  /** 重ね表示中の種別ごとの公開スポット・公開ルート(その種別のキャッシュから読む) */
  const [overlayData, setOverlayData] = useState<
    Map<string, { spots: Spot[]; routes: SpotRoute[] }>
  >(new Map());
  /** 重ね表示中の種別ごとの絞り込み(その種別の地図で保存された内容) */
  const [overlayFilters, setOverlayFilters] = useState<Map<string, SpotFilters>>(
    new Map()
  );
  const [overlayMessage, setOverlayMessage] = useState<string | null>(null);
  // 重ね表示する種別の絞り込みを、種別を切り替えずこの地図の上のモーダルで編集する
  // (編集対象の種別キー。nullならモーダルを出さない)
  const [overlayFilterTypeKey, setOverlayFilterTypeKey] = useState<string | null>(
    null
  );
  // 重ね表示の選択肢(全種別の一覧。/api/spot-typesは閲覧可能な種別のみ返す)
  const [spotTypes, setSpotTypes] = useState<SpotType[]>([]);
  // 左下の種別チップをタップして開く「別の種別へ切り替え」メニューの開閉
  const [showTypeMenu, setShowTypeMenu] = useState(false);
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
  // 未ダウンロードのときにダウンロード確認を出してよい種別。ユーザーが自分で
  // 選んだ種別だけを入れる(保存済み選択の復元でキャッシュが無かった場合=後から
  // キャッシュを削除した場合は、地図を開いただけで突然ダイアログが出ないよう
  // 従来どおり黙って選択を解除する)
  const overlayPromptKeysRef = useRef<Set<string>>(new Set());
  /**
   * レイヤーのクリックハンドラから読む、現在の重ね表示種別(描画順=末尾が最上位)。
   * ハンドラはレイヤー生成時に一度だけ束縛されるためstateではなくrefで渡す
   */
  const overlayKeysRef = useRef<string[]>([]);
  useEffect(() => {
    overlayKeysRef.current = overlayTypeKeys;
  }, [overlayTypeKeys]);
  /**
   * 一度でもレイヤーを作った重ね表示種別。重ねるのをやめた種別のデータを
   * 空にするために覚えておく(レイヤー自体は作り直しを避けるため消さない)
   */
  const createdOverlayKeysRef = useRef<Set<string>>(new Set());

  // 重ね表示側のシリーズ・カテゴリ設定は種別ごとに要るため、hook(useSeriesStyles /
  // useCategories は1種別ぶん)ではなく取得済みの種別一覧から直接解決する
  const overlaySeriesStylesOf = useCallback(
    (key: string) => resolveSeriesStyles(spotTypes.find((t) => t.key === key)),
    [spotTypes]
  );
  const overlayCategoriesOf = useCallback(
    (key: string) => resolveCategories(spotTypes.find((t) => t.key === key)),
    [spotTypes]
  );
  const overlayRankEnabledOf = useCallback(
    (key: string) =>
      getSpotTypeSetting(spotTypes.find((t) => t.key === key), "rank_enabled"),
    [spotTypes]
  );

  // 重ね表示(別種別)のピンのタップ: 作成モード中は本体ピンと同じく追加確認へ回す。
  // それ以外は従来どおり読み取り専用の詳細を開く。ハンドラはレイヤー生成時に一度だけ
  // 束縛されるため、buildModeRef を見て呼び出し時に分岐する(handleSpotSelectと同じ理由)
  const handleOverlaySpotSelect = useCallback((id: string) => {
    if (buildModeRef.current) setAddCandidate(id);
    else setOverlayDetailSpotId(id);
  }, []);

  // 重ね表示スポットのID→Spot(全種別ぶんをまとめる)。作成中パネルや追加確認で
  // 別種別スポットの名前を解決する
  const overlaySpotById = useMemo(() => {
    const m = new Map<string, Spot>();
    for (const { spots: list } of overlayData.values()) {
      for (const s of list) m.set(s.id, s);
    }
    return m;
  }, [overlayData]);

  /**
   * 重ね表示スポットのID→そのスポットの種別キー。経路・ルートの詳細に出す
   * ランク(シリーズ)のバッジで、**そのスポットが属する種別の設定**を当てるのに使う
   * (経路には別種別のスポットが混じるため、本体の設定で描くと色もラベルもずれる)
   */
  const overlayTypeKeyBySpotId = useMemo(() => {
    const m = new Map<string, string>();
    for (const [key, data] of overlayData) {
      for (const spot of data.spots) m.set(spot.id, key);
    }
    return m;
  }, [overlayData]);

  /** 重ね表示中の全種別のルート(タップされたルートの解決に使う) */
  const overlayRoutesAll = useMemo(
    () => [...overlayData.values()].flatMap((d) => d.routes),
    [overlayData]
  );

  // 「リストに追加しますか?」で見せるスポット。まず手元(本体・重ね表示・補完)から
  // 引いて名前をすぐ出す。解決は下書きの経路と同じ3か所から行う
  const addCandidateCached = useMemo(
    () =>
      addCandidate
        ? spotById.get(addCandidate) ??
          overlaySpotById.get(addCandidate) ??
          pathExtraSpots.get(addCandidate) ??
          null
        : null,
    [addCandidate, spotById, overlaySpotById, pathExtraSpots]
  );
  /**
   * 確認ダイアログで説明とWikipediaの入口を出すために取り直した全項目。
   * **公開スポットは手元の値では足りない** —— IndexedDBキャッシュは容量のため
   * `description`も`spot_type_id`も保存しておらず、`expandSpot`が
   * null・空文字のプレースホルダーを入れて返すため(`lib/spotCacheDb.ts`)。
   * 空の`spot_type_id`のまま種別を引くと必ず見つからず、Wikipediaの可否が
   * 種別の設定ではなく既定値(true)で決まってしまう。
   */
  const [addCandidateDetail, setAddCandidateDetail] = useState<Spot | null>(
    null
  );
  useEffect(() => {
    if (!addCandidate) {
      setAddCandidateDetail(null);
      return;
    }
    let cancelled = false;
    api.spots.get(addCandidate).then(({ data }) => {
      if (!cancelled && data) setAddCandidateDetail(data);
    });
    return () => {
      cancelled = true;
    };
  }, [addCandidate]);
  const addCandidateSpot = addCandidateDetail ?? addCandidateCached;
  const addCandidateSpotType = useMemo(
    () =>
      spotTypes.find((t) => t.id === addCandidateDetail?.spot_type_id) ?? null,
    [spotTypes, addCandidateDetail]
  );
  // 確認ダイアログを閉じるときは、その上に開いているWikipediaの概要も一緒に閉じる
  const closeAddCandidate = useCallback(() => {
    setAddCandidate(null);
    setAddCandidateInfo(false);
  }, []);

  // 作成中パネルに渡す解決用マップ。本体スポットに重ね表示スポットと、IDから
  // 個別に取り直した分(pathExtraSpots)を足したもの(IDが被ったら本体を優先)。
  // **補完を混ぜないと、下書きの経路(線)には出ているのにパネルだけ
  // 「(読み込み中のスポット)」のままになる** —— 重ねていない別種別のスポットは
  // 補完でしか名前が手に入らないため
  const buildPanelSpotById = useMemo(() => {
    const m = new Map([...overlaySpotById, ...pathExtraSpots]);
    for (const [id, s] of spotById) m.set(id, s);
    return m;
  }, [overlaySpotById, pathExtraSpots, spotById]);

  // 作成モード中の下書きの経路(選択済みスポットを選んだ順に繋いだもの)。地図に
  // 訪問予定リストと同じ紫の矢印で描き、追加・削除・並び替えに即追従する。
  // スポットは本体+重ね表示+別種別の補完(pathExtraSpots)で解決する
  const buildDraftPath = useMemo(() => {
    if (!buildDraft) return [];
    return buildDraft.spotIds
      .map(
        (id) =>
          spotById.get(id) ?? overlaySpotById.get(id) ?? pathExtraSpots.get(id)
      )
      .filter((s): s is Spot => s !== undefined);
  }, [buildDraft, spotById, overlaySpotById, pathExtraSpots]);

  // 作成モードに入った時点でスポットのある下書き(既存リストの編集など)は、
  // 経路が解決でき次第、全体が見えるよう一度だけ地図を移動する
  // (新規作成で最初のスポットを足したときに地図が飛ばないよう、入場時のみ)
  useEffect(() => {
    if (!buildFitPendingRef.current) return;
    if (!buildDraft) {
      buildFitPendingRef.current = false;
      return;
    }
    if (buildDraftPath.length === 0) return;
    buildFitPendingRef.current = false;
    fitMapToSpots(buildDraftPath);
  }, [buildDraft, buildDraftPath, fitMapToSpots]);
  // 重ね表示の絞り込み変更を、その種別のlocalStorageへ保存しつつstateへ反映する
  // (overlayFiltersが変わると重ね表示の描画effectが再実行され、地図に即反映される)
  const setOverlayFiltersAndSave = useCallback(
    (typeKey: string, next: SpotFilters) => {
      saveFilters(typeKey, next);
      setOverlayFilters((prev) => new Map(prev).set(typeKey, next));
    },
    []
  );

  /** 重ね表示する種別の増減。選んだ順=描画順(後から選んだものが上)で保持する */
  const toggleOverlayTypeKey = useCallback(
    (key: string) => {
      setOverlayTypeKeysState((prev) => {
        const next = prev.includes(key)
          ? prev.filter((k) => k !== key)
          : [...prev, key];
        // 自分で選んだ種別が未ダウンロードのときは、黙って外さずダウンロードを確認する
        if (!prev.includes(key)) overlayPromptKeysRef.current.add(key);
        else overlayPromptKeysRef.current.delete(key);
        saveOverlayTypeKeys(spotTypeKey, next);
        return next;
      });
      setOverlayMessage(null);
    },
    [spotTypeKey]
  );

  /** 重ね表示をすべて解除する(セクションのリセットボタン) */
  const clearOverlayTypeKeys = useCallback(() => {
    overlayPromptKeysRef.current.clear();
    saveOverlayTypeKeys(spotTypeKey, []);
    setOverlayTypeKeysState([]);
    setOverlayMessage(null);
  }, [spotTypeKey]);

  // 重ね表示の選択も、絞り込み条件と同様に保存済みの値を復元する
  useEffect(() => {
    overlayPromptKeysRef.current.clear();
    setOverlayTypeKeysState(loadSavedOverlayTypeKeys(spotTypeKey));
    setOverlayMessage(null);
  }, [spotTypeKey]);

  // アンマウント時は進行中の重ね表示用ダウンロードを打ち切る
  useEffect(() => () => overlayAbortRef.current?.abort(), []);

  // 重ね表示の選択肢用の種別一覧(GETはapi-client側でキャッシュされる)
  useEffect(() => {
    api.spotTypes.list().then(({ data }) => setSpotTypes(data ?? []));
  }, []);

  // 重ね表示のデータ読み込み。スポットもルートも、その種別のダウンロード済み
  // キャッシュ(公開スポットのダウンロード時に公開ルートも一緒に保存される)から読む。
  // 選択が外れた種別のデータ・絞り込みはここで一緒に捨てる
  useEffect(() => {
    let cancelled = false;
    setOverlayFilters(
      new Map(overlayTypeKeys.map((key) => [key, loadSavedFilters(key)]))
    );
    (async () => {
      const loaded: [string, { spots: Spot[]; routes: SpotRoute[] }][] = [];
      const missing: string[] = [];
      for (const key of overlayTypeKeys) {
        const stored = await readSpotCacheDb(key);
        if (cancelled) return;
        if (stored) {
          loaded.push([
            key,
            { spots: stored.spots.map(expandSpot), routes: stored.routes ?? [] },
          ]);
        } else {
          missing.push(key);
        }
      }
      setOverlayData(new Map(loaded));
      if (missing.length === 0) return;
      // 自分で選んだ直後の種別は、その場でダウンロードするか確認する
      // (選択は保持したまま。キャンセル・失敗時にハンドラ側で解除する)
      const prompt = missing.find((key) => overlayPromptKeysRef.current.has(key));
      // 保存済み選択の復元でキャッシュが無かった場合(後からキャッシュを削除した
      // 場合)は、突然ダイアログを出さず黙ってその種別だけ選択を解除する
      const silent = missing.filter((key) => key !== prompt);
      if (silent.length > 0) {
        setOverlayMessage(
          `${silent
            .map((key) => `「${spotTypes.find((t) => t.key === key)?.label ?? key}」`)
            .join("")}の公開スポットが未ダウンロードのため重ねられません。もう一度選ぶとダウンロードできます。`
        );
        setOverlayTypeKeysState((prev) => {
          const next = prev.filter((key) => !silent.includes(key));
          saveOverlayTypeKeys(spotTypeKey, next);
          return next;
        });
      }
      if (prompt) setOverlayDownloadPrompt(prompt);
    })();
    return () => {
      cancelled = true;
    };
    // spotTypesはメッセージの表示名にしか使わないため、依存に入れて読み直す必要はない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayTypeKeys, spotTypeKey]);

  /** ダウンロード確認の「キャンセル」: その種別の重ね表示の選択を解除する */
  const cancelOverlayDownloadPrompt = useCallback(() => {
    const typeKey = overlayDownloadPrompt;
    setOverlayDownloadPrompt(null);
    if (typeKey) toggleOverlayTypeKey(typeKey);
  }, [overlayDownloadPrompt, toggleOverlayTypeKey]);

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
        // キャンセル時はその種別の選択も解除する
        toggleOverlayTypeKey(typeKey);
        return;
      }
      setOverlayData((prev) =>
        new Map(prev).set(typeKey, { spots: entry.spots, routes: entry.routes })
      );
    } catch (err) {
      // toggleOverlayTypeKeyがoverlayMessageを消すため、メッセージは解除の後に出す
      toggleOverlayTypeKey(typeKey);
      setOverlayMessage(
        `ダウンロードに失敗しました${err instanceof Error && err.message ? `: ${err.message}` : ""}`
      );
    } finally {
      overlayAbortRef.current = null;
      setOverlayDownloading(false);
      setOverlayProgress(null);
    }
  }, [overlayDownloadPrompt, toggleOverlayTypeKey]);

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
  // 訪問日を選ぶカレンダー(絞り込みモーダルの上に重ねる別モーダル)
  const [showVisitCalendar, setShowVisitCalendar] = useState(false);
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
    // 地図ごと作り直されるとレイヤーも消えるため、作成済みの記録もリセットする
    createdOverlayKeysRef.current.clear();
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
      // このイベントはOFF(青丸ごと消える)だけでなくドラッグによるBACKGROUND
      // (青丸は残る)でも発火するため、青丸のDOM要素が消えたかどうかでOFFを
      // 見分けて現在地を忘れる。青丸の除去はこのイベントの後に行われることが
      // あるため、1tick置いてから確認する
      setTimeout(() => {
        if (
          !map.getContainer().querySelector(".maplibregl-user-location-dot")
        ) {
          setCurrentLocation(null);
        }
      }, 0);
    };
    geolocate.on("trackuserlocationstart", handleTrackingStart);
    geolocate.on("trackuserlocationend", handleTrackingEnd);
    geolocate.on("error", handleTrackingEnd);

    // 現在地追跡中に「端末が向いている方向」を Google マップ風の扇形コーンで表示する。
    // MapLibre の GeolocateControl には Mapbox の showUserHeading 相当が無いため自前で用意する。
    // コーンは現在地の青丸(.maplibregl-user-location-dot)の子要素として重ねるので、
    // 青丸が addTo / remove されるのに合わせて表示・非表示と位置が自動で同期する。
    // 向きは端末のコンパス(DeviceOrientation)から取り、地図の回転(bearing)ぶんは CSS で補正する。
    const headingCone = document.createElement("div");
    headingCone.className = "tl-heading-cone";
    headingCone.setAttribute("aria-hidden", "true");
    headingCone.style.display = "none";
    // 開き角 約95度・長めの扇形。濃い色の地図上でも見えるよう、根元の不透明度は高めにして
      // 先端に向けて透明にフェードさせる。中心(60,60)が青丸=回転軸で、扇の先端もそこに置く
      // (先端は青丸の背面に隠れ、丸の縁から扇が広がって見える。z-index は CSS で背面に回す)
    headingCone.innerHTML =
      '<svg viewBox="0 0 120 120" width="120" height="120">' +
      '<defs><linearGradient id="tlHeadingGrad" x1="0" y1="60" x2="0" y2="6"' +
      ' gradientUnits="userSpaceOnUse">' +
      '<stop offset="0" stop-color="#1a73e8" stop-opacity="0.6"/>' +
      '<stop offset="0.55" stop-color="#1a73e8" stop-opacity="0.3"/>' +
      '<stop offset="1" stop-color="#1a73e8" stop-opacity="0"/>' +
      "</linearGradient></defs>" +
      '<path d="M60 60 L12 8 Q60 -6 108 8 Z" fill="url(#tlHeadingGrad)"/>' +
      "</svg>";

    let coneAttached = false;
    let lastHeading: number | null = null; // 端末が向く方位(真北からの時計回り度)。未取得は null
    let displayedAngle = 0; // CSS に渡す連続角度(360 度をまたぐ空回りを防ぐため巻き戻さない)

    const renderCone = () => {
      if (lastHeading === null) {
        headingCone.style.display = "none";
        return;
      }
      headingCone.style.display = "";
      // 画面上での見かけの角度 = 端末方位 - 地図の向き。境界で遠回りしないよう差分を ±180 度に丸める
      const target = lastHeading - map.getBearing();
      const delta = ((target - displayedAngle + 540) % 360) - 180;
      displayedAngle += delta;
      headingCone.style.transform = `translate(-50%, -50%) rotate(${displayedAngle}deg)`;
    };

    // 青丸は初回測位時に生成されるため、geolocate イベントで初めて子要素として差し込む
    const handleGeolocate = (e: maplibregl.GeolocatePositionEvent) => {
      // 訪問予定リストの経路の始点(現在地→先頭スポットの線)に使う現在地を覚える。
      // 測位のたびの微小な揺れで再レンダーしないよう、約1m未満の変化は無視する
      const { longitude, latitude } = e.coords;
      setCurrentLocation((prev) =>
        prev &&
        Math.abs(prev[0] - longitude) < 1e-5 &&
        Math.abs(prev[1] - latitude) < 1e-5
          ? prev
          : [longitude, latitude]
      );
      if (!coneAttached) {
        const dot = map
          .getContainer()
          .querySelector<HTMLElement>(".maplibregl-user-location-dot");
        if (dot) {
          dot.appendChild(headingCone);
          coneAttached = true;
        }
      }
      renderCone();
    };
    geolocate.on("geolocate", handleGeolocate);
    map.on("rotate", renderCone);

    const handleOrientation = (
      e: DeviceOrientationEvent & { webkitCompassHeading?: number },
    ) => {
      let heading: number | null = null;
      if (typeof e.webkitCompassHeading === "number") {
        // iOS: 真北からの時計回り度がそのまま得られる
        heading = e.webkitCompassHeading;
      } else if (e.absolute && typeof e.alpha === "number") {
        // その他: 絶対方位センサーの alpha(反時計回り)から換算する
        heading = (360 - e.alpha) % 360;
      }
      if (heading === null || Number.isNaN(heading)) return;
      lastHeading = heading;
      renderCone();
    };

    let orientationStarted = false;
    const startOrientation = () => {
      if (orientationStarted) return;
      orientationStarted = true;
      // 絶対方位(deviceorientationabsolute)を優先し、無い環境は deviceorientation にフォールバック
      window.addEventListener(
        "deviceorientationabsolute",
        handleOrientation as EventListener,
      );
      window.addEventListener(
        "deviceorientation",
        handleOrientation as EventListener,
      );
    };

    // iOS 13+ はユーザー操作を起点にした明示許可が要る。現在地ボタンのタップを起点にする。
    // ボタンは onAdd 内で非同期生成されるため、コンテナへのイベント委譲(キャプチャ)で拾う。
    const orientationApi = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    const handleContainerClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".maplibregl-ctrl-geolocate")) return;
      orientationApi
        .requestPermission?.()
        .then((res) => {
          if (res === "granted") startOrientation();
        })
        .catch(() => {});
    };
    if (typeof orientationApi.requestPermission === "function") {
      map.getContainer().addEventListener("click", handleContainerClick, true);
    } else {
      // 許可が不要な環境(Android / PC)は初めから購読しておく
      startOrientation();
    }

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
      geolocate.off("geolocate", handleGeolocate);
      map.off("rotate", renderCone);
      window.removeEventListener(
        "deviceorientationabsolute",
        handleOrientation as EventListener,
      );
      window.removeEventListener(
        "deviceorientation",
        handleOrientation as EventListener,
      );
      map.getContainer().removeEventListener("click", handleContainerClick, true);
      headingCone.remove();
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
  const loadPlanLists = async () => {
    const { data } = await api.visitPlanLists.list(spotTypeKey);
    setPlanLists(data ?? []);
  };
  const loadHides = async () => {
    const { data } = await api.spotHides.list();
    setHiddenIds(new Set((data ?? []).map((h) => h.spot_id)));
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
      await Promise.all([
        loadPrivateSpots(),
        loadVisits(),
        loadPlanLists(),
        loadHides(),
      ]);
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

  // いま地図に描いている線(ルート・訪問順の経路・訪問予定リストの経路)。
  // **線を描くところと、その経由地をクラスタから外すところの両方が読む**ので、
  // どれを描くかの判断はここ1か所に置く(別々に書くと、線は出ているのに
  // ピンはクラスタに丸められる、という食い違いが起きる)
  const drawnLines = useMemo(() => {
    // 「これだけを表示」中は、注視している経路以外(ルート・もう一方の経路)は描かない
    const isolate = effectiveIsolate(filters);
    const visibleRoutes =
      isolate === null
        ? filterVisibleRoutes(routes, filters, seriesStyles, spotById)
        : [];
    // 訪問順の経路は日ごとに別の線にする(日をまたいで結ばない)
    const visitPathsByDay =
      isolate === "plan"
        ? []
        : buildVisitPathsByDay(visits, filters, pathSpotById);
    // 作成モード中に編集対象のリスト自身を経路表示していた場合は、更新前の経路が
    // 下書きの経路と古い形のまま二重に残らないよう、保存済み側は描かない
    const planListPath =
      isolate === "visit" ||
      (buildDraft !== null && filters.planListId === buildDraft.editingId)
        ? []
        : buildPlanListPath(planLists, filters, pathSpotById);
    return { visibleRoutes, visitPathsByDay, planListPath };
  }, [routes, filters, seriesStyles, spotById, visits, pathSpotById, planLists, buildDraft]);

  /**
   * 描いている線が通るスポットのID。**この集合のピンはクラスタにまとめない** ——
   * 経路を辿っているときに経由地が「N件」の丸へ吸い込まれると、どこへ行くのかが
   * 読めなくなるため(線だけが残り、止まる場所が消える)。
   */
  const pathMemberIds = useMemo(() => {
    const ids = new Set<string>();
    for (const route of drawnLines.visibleRoutes)
      for (const point of route.points) ids.add(point.spot_id);
    for (const day of drawnLines.visitPathsByDay)
      for (const spot of day.path) ids.add(spot.id);
    for (const spot of drawnLines.planListPath) ids.add(spot.id);
    for (const id of buildDraft?.spotIds ?? []) ids.add(id);
    return ids;
  }, [drawnLines, buildDraft]);

  // マーカーの生成・フィルタ反映。
  // 公開スポットも自分の非公開スポットも同じWebGLクラスタ表示で描画する
  // (非公開はピン画像を破線縁取りにして見分ける)。
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;

    // 「これだけを表示」中は、その経路のスポットだけに絞る(他のスポット・ルート・
    // もう一方の経路は隠す)。**ユーザーが明示的に選ぶ表示モード**なので、これだけは
    // 絞り込みより優先する —— 絞り込みも重ねると、訪問状況の既定(未訪問のみ)では
    // 訪問順の経路が1件も残らず、選んでも何も出ないことになるため
    const isolate = effectiveIsolate(filters);
    const isolateIds =
      isolate === "visit"
        ? visitedSpotIdsOn(visits, filters)
        : isolate === "plan"
          ? new Set([
              ...buildPlanListPath(planLists, filters, pathSpotById).map((s) => s.id),
              ...(buildDraft?.spotIds ?? []),
            ])
          : null;
    // **ピンの表示は絞り込み(シリーズ・カテゴリ・訪問状況)と非表示に全部従う。**
    // ルート・経路に含まれるスポットも例外にしない —— かつては「線が通っているのに
    // ピンが無い」のを避けるため経路・ルートの経由地を免除していたが、どのスポットが
    // なぜ出ているのかが絞り込みから読めなくなっていた。
    // **線の方は経由地が絞り込み・非表示で消えても、そのスポットを通る形のまま描く**
    // (ルートは route.points の座標、経路は spots 全件から解決しており、どちらも
    //  ここで絞ったピンの集合とは無関係。道のりが歪まないようにするため)
    const filteredSpots = spots.filter(
      (spot) =>
        (!isolateIds || isolateIds.has(spot.id)) &&
        !hiddenIds.has(spot.id) &&
        passesFilters(
          filters,
          spot.series,
          spot.categories,
          visitedIds.has(spot.id),
          spot.rank
        )
    );

    const renderSpots = async () => {
      ensureClusterLayers(map, overlayKeysRef, handleMapSpotSelect);
      showClusterLayers(map);
      // 使われるピン画像(シリーズ×訪問済み×非公開×形)を先に登録してからデータを流し込む
      // (ラベルが画像の場合は非同期で読み込むため、全件の登録完了を待つ)
      await Promise.all(
        filteredSpots.map((spot) =>
          ensurePinImage(
            map,
            resolveSpotFace(spot.rank, spot.series, seriesStyles, rankEnabled),
            resolveSpotMark(spot.series, seriesStyles),
            resolveSpotShape(spot.series, seriesStyles),
            visitedIds.has(spot.id),
            spot.status === "private"
          )
        )
      );
      if (cancelled) return;
      // **線が通るスポットはクラスタ化しないソースへ回す**(経路を辿るときに
      // 経由地が「N件」の丸へ吸い込まれると、どこへ行くのかが読めなくなるため)。
      displayedSpotsRef.current = filteredSpots;
      // クラスタを止めているときは全部を非クラスタのソースへ回す
      // (ソースを分ける仕組みをそのまま使う)
      const onPath = filters.disableCluster
        ? filteredSpots
        : filteredSpots.filter((spot) => pathMemberIds.has(spot.id));
      const offPath = filters.disableCluster
        ? []
        : filteredSpots.filter((spot) => !pathMemberIds.has(spot.id));
      const stacks = countStacks(filteredSpots);
      const clusterSource = map.getSource(CLUSTER_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      clusterSource?.setData(
        buildClusterGeoJSON(offPath, visitedIds, seriesStyles, rankEnabled, stacks)
      );
      const pathSource = map.getSource(PATH_PIN_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      pathSource?.setData(
        buildClusterGeoJSON(onPath, visitedIds, seriesStyles, rankEnabled, stacks)
      );
      // 本体のレイヤーを重ね表示より後に作った場合でも、重ね表示を上に保つ
      moveOverlayLayersToTop(map, overlayKeysRef.current);
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
    pathSpotById,
    pathMemberIds,
    visits,
    planLists,
    buildDraft,
    visitedIds,
    hiddenIds,
    filters,
    runWhenMapReady,
    seriesStyles,
    rankEnabled,
    routes,
  ]);

  // ルートの矢印描画。経由地2点以上のルートを、巡った順(seq昇順)に繋いだ
  // ラインと進行方向の矢印で描く。シリーズ・カテゴリ絞り込みとの連動はfilterVisibleRoutes参照。
  // 訪問日で絞り込んでいるときは、同じ見た目で自分の訪問順の経路も重ねて描く
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const { visibleRoutes, visitPathsByDay, planListPath } = drawnLines;

    runWhenMapReady(() => {
      ensureRouteLayers(map, overlayKeysRef, openRouteDetail, openPathDetail);
      const source = map.getSource(ROUTES_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      source?.setData(
        buildRouteGeoJSON(map, visibleRoutes, seriesStyles, [
          ...visitPathsByDay.map((day) => ({
            path: day.path,
            color: VISIT_PATH_COLOR,
            kind: "visit" as const,
            date: day.date,
          })),
          {
            path: planListPath,
            color: PLAN_LIST_PATH_COLOR,
            kind: "plan",
            // 現在地(青丸)を表示中は、現在地からリスト先頭のスポットまでも結ぶ
            // (この区間だけ青丸と同じ青)
            start: currentLocation,
            startColor: CURRENT_LOCATION_PATH_COLOR,
          },
          // 作成モード中の下書きの経路。kind無し=線のタップで詳細は開かない
          // (作成中のタップはピンの追加操作を優先するため)。
          // 保存済みリストの経路表示と同じく、現在地(青丸)を表示中は
          // 現在地から下書き先頭のスポットまでも青で結ぶ
          {
            path: buildDraftPath,
            color: PLAN_LIST_PATH_COLOR,
            start: currentLocation,
            startColor: CURRENT_LOCATION_PATH_COLOR,
          },
        ])
      );
    });
  }, [
    drawnLines,
    seriesStyles,
    runWhenMapReady,
    currentLocation,
    buildDraftPath,
    openRouteDetail,
    openPathDetail,
  ]);

  // 別種別の重ね表示の描画。絞り込み・経由地ピンの免除は本体と同じロジックを、
  // その種別の保存済み設定・シリーズ設定で適用する(経路の線そのもの(緑・青)は
  // 本体のルートレイヤーが種別をまたいで1本に描くので、重ね表示側では描かない)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;

    runWhenMapReady(() => {
      // 経路(訪問順・訪問予定リスト)のメンバーは、重ね表示側でも本体と同じく
      // 絞り込み・非表示を免除する —— どちらの経路も別のスポット種別のスポットを
      // 含みうるので、免除が本体種別だけだと「線は通っているのにピンが無い」
      // (非表示にした別種別のスポットがまさにそれ)が起きる。
      // 判定は membership(ID の集合)だけで、絞り込み・ルートは見ない
      // 「これだけを表示」中は、その経路のメンバーだけを残す(本体と同じ扱い)
      const isolate = effectiveIsolate(filters);
      const isolateIds =
        isolate === "visit"
          ? visitedSpotIdsOn(visits, filters)
          : isolate === "plan"
            ? new Set(
                planLists.find((l) => l.id === filters.planListId)?.spot_ids ?? []
              )
            : null;
      const active = overlayTypeKeys;
      // 選択が外れた(・注視で消した)種別は、作成済みレイヤーのデータを空にする
      // (レイヤー自体は残しても害がない。ensureOverlayLayers参照)
      for (const key of createdOverlayKeysRef.current) {
        if (!active.includes(key)) clearOverlayData(map, key);
      }

      const render = async () => {
        for (const typeKey of active) {
          const data = overlayData.get(typeKey);
          // キャッシュ読み込み前・ダウンロード確認中の種別は、まだ何も描かない
          if (!data) {
            if (createdOverlayKeysRef.current.has(typeKey)) {
              clearOverlayData(map, typeKey);
            }
            continue;
          }
          ensureOverlayLayers(
            map,
            typeKey,
            overlayKeysRef,
            handleOverlaySpotSelect,
            setOverlayDetailRouteId
          );
          createdOverlayKeysRef.current.add(typeKey);

          const ids = overlayIds(typeKey);
          const styles = overlaySeriesStylesOf(typeKey);
          const overlayRank = overlayRankEnabledOf(typeKey);
          const typeFilters = overlayFilters.get(typeKey) ?? DEFAULT_FILTERS;
          const spotById = new Map(data.spots.map((s) => [s.id, s]));
          // 「これだけを表示」中は重ね表示のルートも隠す
          // (注視中の経路だけの地図にする)
          const visibleRoutes = isolateIds
            ? []
            : filterVisibleRoutes(data.routes, typeFilters, styles, spotById);
          // ピンは絞り込みと非表示に全部従う(本体と同じ規則)。経路・ルートの
          // メンバーも例外にしない。非表示はスポットIDによるユーザーごとの設定
          // なので種別をまたいで共通に効く
          const filtered = data.spots.filter(
            (spot) =>
              (!isolateIds || isolateIds.has(spot.id)) &&
              !hiddenIds.has(spot.id) &&
              passesFilters(
                typeFilters,
                spot.series,
                spot.categories,
                visitedIds.has(spot.id),
                spot.rank
              )
          );

          // クラスタは重ね先の種別の先頭シリーズの色で塗り、本体の青いクラスタや
          // 他の重ね先と見分けられるようにする(シリーズ設定が空の種別は未知シリーズの
          // ピンと同系のグレー)
          const clusterColor = styles[0]?.color ?? "#9ca3af";
          map.setPaintProperty(ids.cluster, "circle-color", clusterColor);
          map.setPaintProperty(
            ids.clusterCount,
            "text-color",
            autoTextColor(clusterColor)
          );
          // キャッシュには公開スポットしか入らないため、非公開(破線)のピンは不要
          await Promise.all(
            filtered.map((spot) =>
              ensurePinImage(
                map,
                resolveSpotFace(spot.rank, spot.series, styles, overlayRank),
                resolveSpotMark(spot.series, styles),
                resolveSpotShape(spot.series, styles),
                visitedIds.has(spot.id),
                false
              )
            )
          );
          if (cancelled) return;
          (
            map.getSource(ids.source) as maplibregl.GeoJSONSource | undefined
          )?.setData(
            buildClusterGeoJSON(
              filtered,
              visitedIds,
              styles,
              overlayRank,
              countStacks(filtered)
            )
          );
          (
            map.getSource(ids.routeSource) as maplibregl.GeoJSONSource | undefined
          )?.setData(buildRouteGeoJSON(map, visibleRoutes, styles, []));
        }
        if (cancelled) return;
        moveOverlayLayersToTop(map, active);
      };
      render();
    });
    return () => {
      cancelled = true;
    };
  }, [
    overlayTypeKeys,
    overlayData,
    overlayFilters,
    overlaySeriesStylesOf,
    overlayRankEnabledOf,
    visitedIds,
    hiddenIds,
    runWhenMapReady,
    handleOverlaySpotSelect,
    // 「これだけを表示」の切り替えで重ね表示の出し分けが変わるため filters も見る。
    // 経路のメンバー解決に、plan は planLists、visit(選んだ日の訪問)は visits が要る
    filters,
    planLists,
    visits,
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
      ? overlayRoutesAll.find((r) => r.id === overlayDetailRouteId)
      : undefined) ??
    null;
  /**
   * 経路・ルートの詳細に出す1地点ぶんのランク(シリーズ)のバッジ。
   * スポットを手元(本体・経路の補完・重ね表示)から引き、**そのスポットの種別の
   * シリーズ設定**でバッジを描く。引けないスポット(未ダウンロード等)は出さない
   */
  const pointBadge = useCallback(
    (spotId: string) => {
      const spot = pathSpotById.get(spotId) ?? overlaySpotById.get(spotId);
      if (!spot) return null;
      const overlayKey = spotById.has(spotId)
        ? null
        : overlayTypeKeyBySpotId.get(spotId);
      return {
        series: spot.series,
        isPrivate: spot.status === "private",
        // 色はランク由来なので、ランクとその種別の設定も一緒に渡す
        // (重ね表示のスポットは、そのスポット自身の種別の設定で描く)
        rank: spot.rank,
        seriesStyles: overlayKey ? overlaySeriesStylesOf(overlayKey) : seriesStyles,
        rankEnabled: overlayKey ? overlayRankEnabledOf(overlayKey) : rankEnabled,
      };
    },
    [
      pathSpotById,
      overlaySpotById,
      spotById,
      overlayTypeKeyBySpotId,
      overlaySeriesStylesOf,
      overlayRankEnabledOf,
      seriesStyles,
      rankEnabled,
    ]
  );
  // ルート・訪問順の経路・訪問予定リストの経路を、同じ詳細モーダルで出すための共通形。
  // ルートは経由地(区間の説明つき)、経路は地点の並びを表示する
  const routeDetailView: {
    title: string;
    /** 何の線の詳細を見ているか(見出しの上に出すラベル)。3種を同じ見た目の
     *  モーダルで出すため、種類が分からないと現在地を見失う */
    kindLabel: string;
    description?: string | null;
    pointNoun: string;
    /** 訪問予定リストの経路のときだけ、編集リンク用にそのリストを持つ */
    editList?: VisitPlanList;
    points: {
      key: string;
      /** タップでその位置へ移動したあと、このスポットの詳細を開く */
      spotId: string;
      name: string;
      lng: number;
      lat: number;
      legDescription?: string | null;
      badge: ReturnType<typeof pointBadge>;
    }[];
  } | null = detailRoute
    ? {
        title: detailRoute.name,
        kindLabel: "経路",
        description: detailRoute.description,
        pointNoun: "経由地",
        points: detailRoute.points.map((p) => ({
          key: `${p.spot_id}-${p.seq}`,
          spotId: p.spot_id,
          name: p.spot_name,
          lng: p.lng,
          lat: p.lat,
          legDescription: p.description,
          badge: pointBadge(p.spot_id),
        })),
      }
    : detailPathKind === "visit"
      ? (() => {
          // 線は日ごとに分かれているので、詳細もタップした日の1日ぶんだけを出す
          // (期間指定でも「その日に辿った道のり」が読めるように)。日が分からない
          // 古い状態のときは先頭の日にフォールバックする
          const days = buildVisitPathsByDay(visits, filters, pathSpotById);
          const day =
            days.find((d) => d.date === detailPathDate) ?? days[0] ?? null;
          if (!day) return null;
          return {
            title: `訪問順(${formatVisitDate(day.date)})`,
            kindLabel: "訪問順",
            description: `${formatVisitDate(day.date)}に訪問したスポットを、訪問した順に並べています。`,
            pointNoun: "地点",
            points: day.path.map((s, i) => ({
              key: `${s.id}-${i}`,
              spotId: s.id,
              name: s.name,
              lng: s.lng,
              lat: s.lat,
              badge: pointBadge(s.id),
            })),
          };
        })()
      : detailPathKind === "plan"
        ? (() => {
            const list = planLists.find((l) => l.id === filters.planListId);
            const path = buildPlanListPath(planLists, filters, pathSpotById);
            if (!list || path.length === 0) return null;
            return {
              title: list.title,
              kindLabel: "訪問予定リスト",
              description: list.description,
              pointNoun: "地点",
              editList: list,
              // 並び替えでドラッグ中も行の要素を作り直さないよう、キーは位置ではなく
              // スポットのID(リスト内で一意)にする —— 作り直すとポインタの捕捉が
              // 外れて、指を離すまで追従しなくなる
              points: path.map((s) => ({
                key: s.id,
                spotId: s.id,
                name: s.name,
                lng: s.lng,
                lat: s.lat,
                badge: pointBadge(s.id),
              })),
            };
          })()
        : null;
  // 訪問予定リストの経路詳細だけ、地点をつかんで回る順番を入れ替えられる
  // (ルートと訪問順は記録・取り込み済みの事実なので並べ替えない)。
  // ドラッグ中は手元のリストを差し替えて地図の紫の矢印もその場で追従させ、
  // 指を離した時点で1回だけPATCHする
  const detailPanelRef = useRef<HTMLDivElement | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const reorderList = routeDetailView?.editList ?? null;
  /** 経路に出ている地点の新しい並びを、リスト全体(訪問済み・手元に無いスポットを
   *  含む`spot_ids`)へ書き戻す。経路に出ていない行は元の位置のまま動かさない */
  const applyPathOrder = (list: VisitPlanList, orderedIds: string[]) => {
    const shown = new Set(orderedIds);
    let i = 0;
    return list.spot_ids.map((id) => (shown.has(id) ? orderedIds[i++] : id));
  };
  const {
    setRowRef: setPointRowRef,
    dragIndex: pointDragIndex,
    handleProps: pointHandleProps,
  } = useDragReorder({
    items: reorderList ? routeDetailView!.points : [],
    onReorder: (points) => {
      if (!reorderList) return;
      const spotIds = applyPathOrder(
        reorderList,
        points.map((p) => p.spotId)
      );
      setPlanLists((prev) =>
        prev.map((l) => (l.id === reorderList.id ? { ...l, spot_ids: spotIds } : l))
      );
    },
    onCommit: async (points) => {
      if (!reorderList) return;
      const spotIds = applyPathOrder(
        reorderList,
        points.map((p) => p.spotId)
      );
      setSavingOrder(true);
      setOrderError(null);
      // PATCHは経由スポットを丸ごと置き換えるので基本情報も送り直す
      // (送らないと題名・期間が消える。訪問済みはAPI側が控えて戻す)
      const { error } = await api.visitPlanLists.update(reorderList.id, {
        title: reorderList.title,
        description: reorderList.description,
        start_date: reorderList.start_date,
        end_date: reorderList.end_date,
        spot_ids: spotIds,
      });
      setSavingOrder(false);
      if (error) {
        setOrderError("並び順の保存に失敗しました: " + error.message);
      }
      // 成否によらずサーバーの状態に合わせ直す(失敗時は保存できていない並びを残さない)
      loadPlanLists();
    },
    scrollRef: detailPanelRef,
  });

  const closeRouteDetail = () => {
    setOrderError(null);
    setDetailRouteId(null);
    setOverlayDetailRouteId(null);
    setDetailPathKind(null);
    setDetailPathDate(null);
  };

  // 今表示中のスポット種別の表示名(左下のチップに出す)。spotTypesは重ね表示
  // セレクト用に取得済みのものを使い回す。取得完了までは何も出さない
  // (先にキーの生文字列を出すと表示名への切り替わりがちらつくため)
  const currentTypeLabel =
    spotTypes.find((t) => t.key === spotTypeKey)?.label ?? null;
  // 左下の種別チップのタップで切り替えられる他の種別(現在の種別を除く)。
  // public_visible=falseの種別はAPI側でadmin/spot_admin以外には返らない
  const otherTypes = spotTypes.filter((t) => t.key !== spotTypeKey);
  // 「◯◯」の地図で開くで種別を切り替えて来たときの戻り先(?from=)。spotTypesに
  // 見つかる種別だけリンク化する(不正なキー・閲覧できない種別はここで弾かれる)
  const returnType =
    returnTypeKey && returnTypeKey !== spotTypeKey
      ? spotTypes.find((t) => t.key === returnTypeKey) ?? null
      : null;

  return (
    <div
      className={`relative ${
        buildDraft ? "h-dvh" : "h-[calc(100dvh-4rem)]"
      }`}
    >
      <div ref={containerRef} className="h-full w-full" />

      {/* 今表示中のスポット種別と「元の地図に戻る」リンク(左下に小さく表示。
          attributionは右下なので重ならない)。種別チップはタップで
          「別の種別へ切り替え」メニュー(other種別への遷移)を開くボタンにしている */}
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
          <div className="relative">
            {/* メニューを開いている間の画面全体の当たり判定(外側タップで閉じる) */}
            {showTypeMenu && (
              <button
                type="button"
                aria-label="メニューを閉じる"
                onClick={() => setShowTypeMenu(false)}
                className="fixed inset-0 z-0 cursor-default"
              />
            )}
            {/* **今表示中の種別も一覧に出す**(押せない)。他の種別だけを並べると、
                どこから切り替わったのか・全体で何種類あるのかが読めないため。
                並びは管理画面で決めた順(APIの返り順)をそのまま使う */}
            {showTypeMenu && spotTypes.length > 0 && (
              <div className="absolute bottom-full left-0 z-10 mb-1.5 max-h-[50dvh] w-56 overflow-y-auto rounded-xl bg-white py-1 shadow-lg ring-1 ring-black/10">
                {spotTypes.map((t) => {
                  const label = (
                    <span>
                      {t.label}
                      {!getSpotTypeSetting(t, "public_visible") && (
                        <span className="ml-1.5 text-xs text-gray-400">
                          (管理者のみ)
                        </span>
                      )}
                    </span>
                  );
                  return t.key === spotTypeKey ? (
                    <div
                      key={t.id}
                      aria-current="true"
                      className="flex items-center justify-between gap-2 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-500"
                    >
                      {label}
                      <span className="shrink-0 text-xs text-gray-400">表示中</span>
                    </div>
                  ) : (
                    <Link
                      key={t.id}
                      href={`/${t.key}/map`}
                      onClick={() => setShowTypeMenu(false)}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {label}
                      <span className="text-gray-400">›</span>
                    </Link>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              onClick={() => setShowTypeMenu((v) => !v)}
              className="relative z-10 flex items-center gap-1 rounded-full bg-white/85 px-2.5 py-1 text-xs font-medium text-gray-700 shadow"
            >
              {currentTypeLabel}
              {otherTypes.length > 0 && (
                <span className="text-gray-400">{showTypeMenu ? "▾" : "▴"}</span>
              )}
            </button>
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

      {/* 訪問日を選ぶカレンダー。絞り込みモーダル(z-50)の上に重ねる。
          期間の選択は2回のタップで決まるので、**選んでも閉じない**
          (1回目のタップで閉じると期間を選べない)。選択はその場で反映されるため、
          閉じる操作は「閉じる」だけでよい */}
      {showVisitCalendar && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowVisitCalendar(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85dvh] w-full max-w-xs space-y-2 overflow-y-auto rounded-2xl bg-white p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold">訪問日</h2>
              <button
                type="button"
                onClick={() => setShowVisitCalendar(false)}
                aria-label="閉じる"
                className="rounded-full px-2 text-xl leading-none text-gray-400"
              >
                ×
              </button>
            </div>
            <p className="text-sm">
              {filters.visitedDate ? (
                <>
                  {formatVisitDate(filters.visitedDate)}
                  {filters.visitedDateTo && (
                    <> 〜 {formatVisitDate(filters.visitedDateTo)}</>
                  )}
                </>
              ) : (
                <span className="text-gray-400">表示しない</span>
              )}
            </p>
            <VisitDateCalendar
              from={filters.visitedDate}
              to={filters.visitedDateTo}
              markedDates={visitDateSet}
              today={visitDateOptions.today}
              onSelect={handleSelectVisitDate}
            />
            <p className="text-xs text-gray-400">
              日付をタップで1日、続けてもう1日タップで期間。
              <span className="mx-1 inline-block size-1 rounded-full bg-green-600 align-middle" />
              の日に訪問記録があります。
            </p>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleSelectVisitDate(visitDateOptions.today, null)}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm"
              >
                今日
              </button>
              <button
                type="button"
                onClick={() => handleSelectVisitDate(null, null)}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm"
              >
                表示しない
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 絞り込みモーダル */}
      {showFilterModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setShowFilterModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold">絞り込み</h2>
              <div className="flex items-center gap-3">
                {/* 見出しのリセットは絞り込み(シリーズ・カテゴリ・訪問状況)のみを
                    既定に戻す。訪問日・訪問予定リスト・重ね表示は各セクションの
                    個別リセットボタンで戻す */}
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
            {/* 経路の表示トグルはここでは出さない(「表示」の節=ダウンロードの上へ移した) */}
            <FilterBar
              spots={spots}
              filters={filters}
              onChange={setFilters}
              showReset={false}
              seriesStyles={seriesStyles}
              rankEnabled={rankEnabled}
              categories={categories}
            />

            {/* 訪問順の経路の対象日(絞り込みではなく、その日に訪問したスポットを
                訪問順に緑の矢印で結ぶ。重ね表示セクションと同じ区切り線を上に置く) */}
            <div className="border-t border-gray-100 pt-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  訪問日
                  <HelpTip>
                    選んだ日(期間)に訪問したスポットを、訪問した順に矢印(緑)で結んで地図に表示します。期間を選ぶと日をまたいで1本の経路になります。対象のスポットは、絞り込みで外れていても・別のスポット種別でも表示されます。
                  </HelpTip>
                </p>
                <div className="flex shrink-0 items-center gap-1.5">
                  {/* その日のスポットだけに絞る(他のスポット・ルート・訪問予定リストは隠す) */}
                  <button
                    type="button"
                    disabled={!filters.visitedDate}
                    aria-pressed={filters.isolate === "visit"}
                    onClick={() =>
                      setFilters({
                        ...filters,
                        isolate: filters.isolate === "visit" ? null : "visit",
                      })
                    }
                    className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium disabled:opacity-40 ${
                      filters.isolate === "visit"
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-gray-300 bg-white text-gray-500"
                    }`}
                  >
                    これだけを表示
                  </button>
                  {/* このセクションだけのリセット(対象日を既定=今日に戻し、
                      「これだけを表示」も解除する) */}
                  <SectionResetButton
                    disabled={
                      filters.visitedDate === visitDateOptions.today &&
                      filters.visitedDateTo === null &&
                      filters.isolate !== "visit"
                    }
                    onClick={() =>
                      setFilters({
                        ...filters,
                        visitedDate: todayKey(),
                        visitedDateTo: null,
                        isolate:
                          filters.isolate === "visit" ? null : filters.isolate,
                      })
                    }
                  />
                </div>
              </div>
              {/* 選択中の対象日(期間)。タップでカレンダーを別モーダルで開く
                  (絞り込みモーダルにカレンダーを直に置くと、他の条件を見るのに
                  毎回その分スクロールすることになるため)。「今日」「表示しない」は
                  よく使うのでここに残す */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowVisitCalendar(true)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-left text-sm"
                >
                  <CalendarIcon className="size-4 shrink-0 text-gray-400" />
                  <span className="min-w-0 truncate">
                    {filters.visitedDate ? (
                      <>
                        {formatVisitDate(filters.visitedDate)}
                        {filters.visitedDateTo && (
                          <> 〜 {formatVisitDate(filters.visitedDateTo)}</>
                        )}
                      </>
                    ) : (
                      <span className="text-gray-400">表示しない</span>
                    )}
                  </span>
                </button>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() =>
                      handleSelectVisitDate(visitDateOptions.today, null)
                    }
                    className="rounded-full border border-gray-300 px-2.5 py-1 text-xs text-gray-600"
                  >
                    今日
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectVisitDate(null, null)}
                    className="rounded-full border border-gray-300 px-2.5 py-1 text-xs text-gray-600"
                  >
                    表示しない
                  </button>
                </div>
              </div>
            </div>

            {/* 訪問予定リスト(旅程)の経路。訪問日と同様、リストのスポットを
                リスト順に矢印(紫)で結び、選ぶと経路全体が画面に収まる */}
            {planLists.length > 0 && (
              <div className="border-t border-gray-100 pt-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    訪問予定リスト
                    <HelpTip>
                      選んだリストのスポットを、リストの順に矢印(紫)で結んで地図に表示します。リストのスポットは、絞り込みで外れていても表示されます。
                    </HelpTip>
                  </p>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {/* そのリストのスポットだけに絞る(他のスポット・ルート・訪問順の経路は隠す) */}
                    <button
                      type="button"
                      disabled={!filters.planListId}
                      aria-pressed={filters.isolate === "plan"}
                      onClick={() =>
                        setFilters({
                          ...filters,
                          isolate: filters.isolate === "plan" ? null : "plan",
                        })
                      }
                      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium disabled:opacity-40 ${
                        filters.isolate === "plan"
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-gray-300 bg-white text-gray-500"
                      }`}
                    >
                      これだけを表示
                    </button>
                    {/* このセクションだけのリセット(「表示しない」へ戻し、
                        「これだけを表示」も解除する) */}
                    <SectionResetButton
                      disabled={
                        filters.planListId === null &&
                        filters.isolate !== "plan"
                      }
                      onClick={() =>
                        setFilters({
                          ...filters,
                          planListId: null,
                          isolate:
                            filters.isolate === "plan" ? null : filters.isolate,
                        })
                      }
                    />
                  </div>
                </div>
                <select
                  aria-label="経路表示する訪問予定リスト"
                  value={filters.planListId ?? ""}
                  onChange={(e) => handleSelectPlanList(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm"
                >
                  <option value="">表示しない</option>
                  {planLists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.title}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 別の種別を重ねて表示(複数選択可)。選んだ順に上へ重なり、
                種別ごとに絞り込みを編集できる */}
            {spotTypes.filter((t) => t.key !== spotTypeKey).length > 0 && (
              <div className="border-t border-gray-100 pt-3">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="flex items-center gap-1.5 text-sm font-medium">
                    別の種別を重ねて表示
                    <HelpTip>
                      選んだ種別の公開スポットと経路を半透明で重ねて表示します(複数選べます。未ダウンロードの種別は、ダウンロードするかどうかの確認が出ます)。絞り込みとルート表示のオン/オフは種別ごとに、その種別の地図で自分が設定した内容に従います。
                    </HelpTip>
                  </p>
                  {/* このセクションだけのリセット(すべて「重ねない」へ戻す) */}
                  <SectionResetButton
                    disabled={overlayTypeKeys.length === 0}
                    onClick={clearOverlayTypeKeys}
                  />
                </div>
                <ul className="max-h-56 divide-y divide-gray-100 overflow-y-auto rounded-lg border border-gray-200">
                  {spotTypes
                    .filter((t) => t.key !== spotTypeKey)
                    .map((t) => {
                      const selected = overlayTypeKeys.includes(t.key);
                      return (
                        <li
                          key={t.key}
                          className="flex items-center justify-between gap-2 px-2.5 py-1.5"
                        >
                          <label className="flex min-w-0 flex-1 items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleOverlayTypeKey(t.key)}
                              className="size-4 shrink-0 accent-blue-600"
                            />
                            <span className="min-w-0 truncate text-sm">
                              {t.label}
                            </span>
                          </label>
                          {/* 種別を切り替えず、この地図の上のモーダルで重ね表示側の
                              絞り込みを編集する(変更はその種別のlocalStorageへ
                              保存され、描画にも即反映) */}
                          {selected && overlayData.has(t.key) && (
                            <button
                              type="button"
                              onClick={() => setOverlayFilterTypeKey(t.key)}
                              className="shrink-0 text-xs text-blue-600 underline"
                            >
                              絞り込みを編集
                            </button>
                          )}
                        </li>
                      );
                    })}
                </ul>
                {overlayMessage && (
                  <p className="mt-1 text-xs text-red-600">{overlayMessage}</p>
                )}
              </div>
            )}

            {/* 地図の見せ方の切り替え(絞り込みではない)。ダウンロードのすぐ上に置く */}
            <div className="border-t border-gray-100 pt-3">
              <p className="mb-2 text-sm font-medium">表示</p>
              <div className="flex flex-wrap gap-1.5">
                {routes.length > 0 && (
                  <button
                    type="button"
                    aria-pressed={filters.showRoutes}
                    onClick={() =>
                      setFilters({ ...filters, showRoutes: !filters.showRoutes })
                    }
                    className={`rounded-full border px-3 py-1 text-sm font-medium ${
                      filters.showRoutes
                        ? "border-blue-600 bg-blue-600 text-white"
                        : "border-gray-300 bg-white text-gray-400"
                    }`}
                  >
                    経路を表示
                  </button>
                )}
                <button
                  type="button"
                  aria-pressed={filters.disableCluster}
                  onClick={() =>
                    setFilters({
                      ...filters,
                      disableCluster: !filters.disableCluster,
                    })
                  }
                  className={`rounded-full border px-3 py-1 text-sm font-medium ${
                    filters.disableCluster
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-400"
                  }`}
                >
                  クラスタ表示を無効化
                </button>
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {routes.length > 0 && "経路は巡った順の矢印です。"}
                クラスタ表示を無効にすると、近くのピンを「N件」の丸にまとめず1件ずつ出します
                (件数が多い種別では地図が重くなります)。
              </p>
            </div>

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
              <div className="flex gap-2">
              <button
                type="button"
                onClick={spotCache.startManualDownload}
                disabled={spotCache.checkingSize || spotCache.downloading}
                className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
              >
                {spotCache.checkingSize
                  ? "確認中…"
                  : spotCache.downloading
                    ? "ダウンロード中…"
                    : "ダウンロード"}
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
                className="flex-1 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-red-600 disabled:opacity-50"
              >
                キャッシュ削除
              </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 重ね表示する種別の絞り込みを、種別を切り替えずこの地図の上で編集するモーダル。
          変更はその種別のlocalStorageへ保存し、重ね表示の描画にも即反映される */}
      {overlayFilterTypeKey &&
        overlayData.has(overlayFilterTypeKey) &&
        (() => {
          const typeKey = overlayFilterTypeKey;
          const overlayType = spotTypes.find((t) => t.key === typeKey);
          const data = overlayData.get(typeKey)!;
          const typeFilters = overlayFilters.get(typeKey) ?? DEFAULT_FILTERS;
          return (
            <div
              className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
              onClick={() => setOverlayFilterTypeKey(null)}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="max-h-[85dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-4"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-bold">
                    「{overlayType?.label ?? typeKey}」の絞り込み
                  </h2>
                  <div className="flex items-center gap-3">
                    <FilterResetButton
                      filters={typeFilters}
                      onChange={(next) => setOverlayFiltersAndSave(typeKey, next)}
                    />
                    <button
                      type="button"
                      onClick={() => setOverlayFilterTypeKey(null)}
                      aria-label="閉じる"
                      className="text-xl leading-none text-gray-400"
                    >
                      ✕
                    </button>
                  </div>
                </div>
                <p className="text-xs text-gray-500">
                  重ねて表示している「{overlayType?.label ?? typeKey}」の
                  絞り込み・経路表示です。ここでの変更はこの種別の地図にも保存されます。
                </p>
                <FilterBar
                  spots={data.spots}
                  filters={typeFilters}
                  onChange={(next) => setOverlayFiltersAndSave(typeKey, next)}
                  showReset={false}
                  seriesStyles={overlaySeriesStylesOf(typeKey)}
                  rankEnabled={overlayRankEnabledOf(typeKey)}
                  categories={overlayCategoriesOf(typeKey)}
                  showRouteToggle={data.routes.length > 0}
                />
              </div>
            </div>
          );
        })()}

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60">
          <p className="text-sm text-gray-600">読み込み中…</p>
        </div>
      )}

      {/* 訪問予定リスト作成モード: 右側パネル(選択済みスポットの並び替え・削除・入力完了) */}
      {buildDraft && (
        <PlanBuildPanel
          title={buildDraft.title}
          editing={buildDraft.editingId !== null}
          spotIds={buildDraft.spotIds}
          spotsById={buildPanelSpotById}
          seriesStyles={seriesStyles}
          saving={savingList}
          onReorder={(spotIds) =>
            updateBuildDraft({ ...buildDraft, spotIds })
          }
          onRemove={(spotId) =>
            updateBuildDraft({
              ...buildDraft,
              spotIds: buildDraft.spotIds.filter((s) => s !== spotId),
            })
          }
          onComplete={completeBuild}
          onCancel={cancelBuild}
        />
      )}
      {buildError && (
        <div className="absolute left-1/2 top-2 z-30 -translate-x-1/2 rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white shadow">
          {buildError}
        </div>
      )}

      {/* 作成モード中にピンをタップしたとき: リストへ追加するか確認するダイアログ。
          名前だけでは入れるか決められないため、スポットの説明とWikipediaの概要への
          入口も出す(Wikipediaはスポット詳細と同じくその種別で有効なときだけ) */}
      {addCandidate && buildDraft && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
          onClick={closeAddCandidate}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85dvh] w-full max-w-sm space-y-3 overflow-y-auto rounded-2xl bg-white p-4"
          >
            {(() => {
              const spot = addCandidateSpot;
              const already = buildDraft.spotIds.includes(addCandidate);
              return (
                <>
                  <p className="text-sm">
                    <span className="font-bold">{spot?.name ?? "このスポット"}</span>
                    {already
                      ? " はすでにリストに入っています。"
                      : " を訪問予定リストに追加しますか?"}
                  </p>
                  {spot?.description && (
                    <p className="whitespace-pre-wrap text-sm text-gray-600">
                      {spot.description}
                    </p>
                  )}
                  {/* 取り直しが済むまでは出さない(種別が分かるまで可否を
                      決められず、既定値で出すと後から消えてちらつくため) */}
                  {addCandidateDetail &&
                    getSpotTypeSetting(
                      addCandidateSpotType,
                      "wikipedia_enabled"
                    ) && (
                    <button
                      type="button"
                      onClick={() => setAddCandidateInfo(true)}
                      className="inline-flex items-center gap-1 rounded p-1 text-sm text-blue-600 hover:bg-blue-50"
                    >
                      <WikipediaIcon className="size-5" />
                      Wikipediaで見る
                    </button>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={closeAddCandidate}
                      className="flex-1 rounded-lg border border-gray-300 py-2 text-sm"
                    >
                      {already ? "閉じる" : "キャンセル"}
                    </button>
                    {!already && (
                      <button
                        type="button"
                        onClick={() => {
                          updateBuildDraft({
                            ...buildDraft,
                            spotIds: [...buildDraft.spotIds, addCandidate],
                          });
                          closeAddCandidate();
                        }}
                        className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white"
                      >
                        追加する
                      </button>
                    )}
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* 追加の確認から開くWikipediaの概要。確認ダイアログより後ろに置くことで
          同じ z-[60] でも上に重なる(閉じると確認ダイアログに戻る) */}
      {addCandidateInfo && addCandidateSpot && (
        <SpotInfoModal
          spotName={addCandidateSpot.name}
          region={addCandidateSpot.region}
          lang={resolveWikipediaLang(addCandidateSpotType)}
          primaryTitle={
            resolveWikipediaTitleSource(addCandidateSpotType) === "series"
              ? addCandidateSpot.series
              : null
          }
          onClose={() => setAddCandidateInfo(false)}
        />
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
              className="block w-full whitespace-nowrap px-4 py-2 text-left text-sm hover:bg-gray-50"
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
          onSaved={(spot, visitRecorded) => {
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
            // 追加と同時に訪問を記録したときは、訪問済み表示・訪問日の経路も更新する
            if (visitRecorded) loadVisits();
            setAddSpotAt(null);
          }}
        />
      )}

      {/* ルート・経路の詳細モーダル(ルート/訪問順の経路/訪問予定リストの経路の線・矢印の
          タップで開く。重ね表示のルートも共用) */}
      {routeDetailView && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={closeRouteDetail}
        >
          <div
            ref={detailPanelRef}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                {/* 3種(ルート/訪問順の経路/訪問予定リスト)を同じ見た目のモーダルで
                    出すため、何の線を見ているのかを見出しの上に必ず出す */}
                <p className="text-xs font-medium text-gray-500">
                  {routeDetailView.kindLabel}
                </p>
                <h2 className="font-bold">{routeDetailView.title}</h2>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                {/* 訪問予定リストの経路のときは、そのリストの基本情報編集へ遷移する */}
                {routeDetailView.editList && (
                  <button
                    type="button"
                    onClick={() => {
                      const list = routeDetailView.editList!;
                      // この編集は地図から始まった。完了・キャンセルで地図へ戻す
                      buildFromMapRef.current = true;
                      closeRouteDetail();
                      setEditingPlanList(list);
                    }}
                    className="text-sm text-blue-600 underline"
                  >
                    編集
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeRouteDetail}
                  aria-label="閉じる"
                  className="text-xl leading-none text-gray-400"
                >
                  ✕
                </button>
              </div>
            </div>
            {routeDetailView.description && (
              <p className="whitespace-pre-wrap text-sm text-gray-700">
                {routeDetailView.description}
              </p>
            )}
            {routeDetailView.points.length > 0 && (
              <div className="border-t border-gray-100 pt-3 text-sm">
                {/* 全地点を巡った順に並べ、2点の間にその区間の説明(ルートのみ)を挟む */}
                <ol className="space-y-0.5">
                  {routeDetailView.points.map((point, i) => (
                    <li key={point.key} ref={setPointRowRef(i)}>
                      <div
                        className={`flex items-center gap-2 ${
                          pointDragIndex === i ? "bg-blue-100" : ""
                        }`}
                      >
                        {/* 訪問予定リストのときだけ、つかんで回る順番を入れ替えられる。
                            touch-action: noneはハンドルにだけ当てる(行本体まで
                            当てると一覧がタッチスクロールできなくなる) */}
                        {reorderList && (
                          <span
                            {...pointHandleProps(i)}
                            className={`${REORDER_HANDLE_CLASS} self-stretch py-1 pl-0.5 pr-0.5 text-base leading-none`}
                          >
                            <span className="flex h-full items-center">≡</span>
                          </span>
                        )}
                        <span className="w-6 shrink-0 text-right text-xs font-medium tabular-nums text-gray-500">
                          {i + 1}
                        </span>
                        {/* ランク(シリーズ)のバッジ。地点がどのランクなのかは
                            経路を辿るときの判断材料になるため名前の隣に出す。
                            手元に無いスポット(未ダウンロード等)は出さない */}
                        {point.badge && (
                          <SpotBadge
                            rank={point.badge.rank}
                            series={point.badge.series}
                            seriesStyles={point.badge.seriesStyles}
                            rankEnabled={point.badge.rankEnabled}
                            isPrivate={point.badge.isPrivate}
                            size="sm"
                          />
                        )}
                        {/* スポット名のタップでその位置へ飛び、続けてそのスポットの
                            詳細を開く(一覧から辿ったときに、そこが何なのかを
                            見に行くまでが1タップで済むように)。詳細は本体種別の
                            スポットなら通常のモーダル、別種別なら読み取り専用
                            (ピンをタップしたときと同じ出し分け) */}
                        <button
                          type="button"
                          onClick={() => {
                            closeRouteDetail();
                            mapRef.current?.flyTo({
                              center: [point.lng, point.lat],
                              zoom: 16,
                            });
                            if (spotById.has(point.spotId)) {
                              setDetailSpotId(point.spotId);
                            } else {
                              setOverlayDetailSpotId(point.spotId);
                            }
                          }}
                          className="min-w-0 truncate text-left font-medium text-blue-600 underline"
                        >
                          {point.name}
                        </button>
                      </div>
                      {/* 区間の説明は次の地点との間に表示(最終地点には次の区間が無い) */}
                      {i < routeDetailView.points.length - 1 && (
                        <div className="flex items-baseline gap-2 py-0.5 text-xs text-gray-500">
                          {/* 並び替えハンドルのぶんの空き(番号の列を上下でそろえる) */}
                          {reorderList && <span className="w-5 shrink-0" />}
                          <span className="w-6 shrink-0 text-right">↓</span>
                          {point.legDescription && (
                            <span className="min-w-0 whitespace-pre-wrap">
                              {point.legDescription}
                            </span>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
                <p className="pt-2 text-xs text-gray-500">
                  {routeDetailView.pointNoun}
                  {routeDetailView.points.length}件。スポット名をタップすると、その位置へ移動して詳細を開きます。
                  {reorderList &&
                    routeDetailView.points.length > 1 &&
                    (savingOrder
                      ? "並び順を保存中…"
                      : "左端の≡をつかんで動かすと、回る順番を入れ替えられます(訪問済みのスポットは経路に出ないため動きません)。")}
                </p>
                {orderError && (
                  <p className="pt-1 text-xs text-red-600">{orderError}</p>
                )}
                {/* 経路全体をGoogle マップの経路検索で開く(先頭が出発地、
                    途中が経由地、最後が目的地) */}
                <div className="pt-2">
                  <GoogleMapsRouteLink points={routeDetailView.points} />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 訪問予定リストの基本情報編集モーダル(経路詳細の「編集」で開く)。保存すると
          ?buildList=1 へ遷移し、地図の作成モードで経由スポットを編集する */}
      {editingPlanList && (
        <VisitPlanListFormModal
          typeKey={spotTypeKey}
          edit={editingPlanList}
          onClose={() => {
            // 基本情報モーダルでキャンセルした(スポット編集へ進まなかった)ときは
            // 地図起点フラグも下ろす
            setEditingPlanList(null);
            buildFromMapRef.current = false;
          }}
          // 地図へ行かず「保存」で基本情報だけ直した場合。経路表示中のリストの
          // 題名・期間が変わるので読み直す(経由スポットは変わっていない)
          onSaved={() => {
            api.visitPlanLists
              .list(spotTypeKey)
              .then(({ data }) => setPlanLists(data ?? []));
          }}
        />
      )}

      {/* 重ね表示スポットの詳細モーダル(読み取り専用。スポットの編集・削除等の
          更新系は出さないが、訪問記録と、今開いている種別の訪問予定リストへの
          追加はできる) */}
      {overlayDetailSpotId && (
        <SpotDetailModal
          spotId={overlayDetailSpotId}
          readOnly
          allowVisitRecording
          allowPlanList
          onClose={() => setOverlayDetailSpotId(null)}
          onVisitChange={loadVisits}
          // 重ね表示スポットを現在の種別のリストへ追加したら、経路表示中のリストの
          // 線にも反映されるようリスト一覧を取り直す
          onPlanListChange={loadPlanLists}
        />
      )}

      {/* スポット詳細モーダル */}
      {/* 同じ座標にスポットが重なっているときの選択一覧。ピンは完全に重なって
          しまい下のスポットを開く手段が無くなるため、タップでここに列挙する
          (ピン側には「+N」バッジを出して重なりの存在を知らせている) */}
      {stackSpotIds && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
          onClick={() => setStackSpotIds(null)}
        >
          {/* 横幅は一覧に必要な分だけ。件数が多いと縦に伸びるので、画面の高さいっぱいまで
              使い、はみ出す分だけ一覧側をスクロールさせる */}
          <div
            className="flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-semibold">
                この地点のスポット({stackSpotIds.length}件)
              </h2>
              <button
                type="button"
                className="text-slate-400 hover:text-slate-600"
                aria-label="閉じる"
                onClick={() => setStackSpotIds(null)}
              >
                ✕
              </button>
            </div>
            <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
              {stackSpotIds.map((id) => {
                const spot = spotById.get(id);
                if (!spot) return null;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-slate-50"
                      onClick={() => {
                        setStackSpotIds(null);
                        handleSpotSelect(id);
                      }}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{spot.name}</span>
                        {/* 一覧・詳細と同じ1行(同じ地点なので地域は出さない) */}
                        <span className="block truncate text-xs text-slate-500">
                          {formatSpotMeta(spot, {
                            rankEnabled,
                            categories,
                            includeRegion: false,
                          })}
                        </span>
                      </span>
                      {visitedIds.has(id) && (
                        <span className="shrink-0 text-xs text-green-600">✓訪問済み</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {detailSpotId && (
        <SpotDetailModal
          spotId={detailSpotId}
          spots={spots}
          onClose={() => setDetailSpotId(null)}
          onVisitChange={loadVisits}
          // 既存の訪問予定リストへの追加をリスト一覧へ反映する(経路表示中の
          // リストに追加した場合、地図の紫の経路も引き直される)
          onPlanListChange={loadPlanLists}
          // 非表示にする/解除をピンの表示へ即反映する
          onHideChange={loadHides}
          onSpotChange={(spot) => {
            spotCache.applySpotChange(spot);
            loadPrivateSpots();
          }}
          onSpotDeleted={(id) => {
            spotCache.applySpotDelete(id);
            loadPrivateSpots();
          }}
          onOpenSpot={setDetailSpotId}
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
