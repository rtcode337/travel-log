"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { Role, Spot, SpotRoute, Visit } from "@/lib/types";
import type { SeriesStyleDefinition } from "@/lib/seriesStyle";
import { ensurePinImage, pinIconId, PIN_ICON_PAD } from "@/lib/pinIcon";
import { formatBytes, formatDownloadedAt, useSpotCache } from "@/lib/useSpotCache";
import { useSeriesStyles } from "@/lib/useSeriesStyles";
import { useCategories } from "@/lib/useCategories";
import FilterBar, {
  DEFAULT_FILTERS,
  passesFilters,
  toVisitDateKey,
  type SpotFilters,
  type VisitedValue,
} from "@/components/FilterBar";
import AddSpotModal from "@/components/AddSpotModal";
import SpotDetailModal from "@/components/SpotDetailModal";
import SpotDownloadDialogs from "@/components/SpotDownloadDialogs";

const CLUSTER_SOURCE_ID = "spots-cluster";
const CLUSTER_LAYER_ID = "spots-clusters";
const CLUSTER_COUNT_LAYER_ID = "spots-cluster-count";
const UNCLUSTERED_LAYER_ID = "spots-unclustered-point";

const ROUTES_SOURCE_ID = "spot-routes";
const ROUTE_LINE_LAYER_ID = "spot-routes-line";
const ROUTE_ARROW_LAYER_ID = "spot-routes-arrow";

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
 * (クラスタレイヤーは後から追加されるとルートの上に載るため、どちらの順でもピンが上になる)
 */
function ensureRouteLayers(map: maplibregl.Map) {
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
}

/**
 * シリーズ絞り込みを適用した表示対象のルート(経由地2点以上)を返す。
 * シリーズが「すべて」(絞り込みなし)のときは全ルートの線が重なって地図が
 * 見づらくなるため、ルートは一切表示しない。シリーズで絞り込んでいるときは、
 * ルートのseriesがこの種別のシリーズ一覧にあるものだけ絞り込みに連動して
 * 出し分け、シリーズ未指定・一覧に無いシリーズのルートは対象外として表示する
 */
function filterVisibleRoutes(
  routes: SpotRoute[],
  filters: SpotFilters,
  seriesStyles: SeriesStyleDefinition[]
): SpotRoute[] {
  if (filters.series.length === 0) return [];
  const knownSeries = new Set(seriesStyles.map((s) => s.series));
  return routes.filter(
    (route) =>
      route.points.length >= 2 &&
      (route.series === null ||
        !knownSeries.has(route.series) ||
        filters.series.includes(route.series))
  );
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

/**
 * ルート(と、訪問日で絞り込み中なら訪問順の経路)をGeoJSONのLineString群にする。
 * 矢印画像の登録もここで済ませる
 */
function buildRouteGeoJSON(
  map: maplibregl.Map,
  routes: SpotRoute[],
  seriesStyles: SeriesStyleDefinition[],
  visitPath: Spot[]
): GeoJSON.FeatureCollection<GeoJSON.LineString, { color: string; icon: string }> {
  const visitFeatures: GeoJSON.Feature<
    GeoJSON.LineString,
    { color: string; icon: string }
  >[] =
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
      ...routes.map<
        GeoJSON.Feature<GeoJSON.LineString, { color: string; icon: string }>
      >((route) => {
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
          properties: { color, icon: ensureRouteArrowImage(map, color) },
        };
      }),
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
    };
    if (
      filters.series.length === 0 &&
      filters.categories.length === 0 &&
      filters.visited.length === 0 &&
      !filters.visitedDate
    ) {
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
  // この種別のルート(スポットを巡った順の矢印)。管理画面のルートCSVインポートで作られる
  const [routes, setRoutes] = useState<SpotRoute[]>([]);
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
  // シリーズ・カテゴリ・訪問状況・訪問日のいずれかで絞り込み中か(絞り込みボタンの見た目に使う)
  const filtersActive =
    filters.series.length > 0 ||
    filters.categories.length > 0 ||
    filters.visited.length > 0 ||
    !!filters.visitedDate;
  const [detailSpotId, setDetailSpotId] = useState<string | null>(null);
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

  const loadRoutes = useCallback(async () => {
    const { data } = await api.routes.list(spotTypeKey);
    setRoutes(data ?? []);
  }, [spotTypeKey]);

  // データ取得
  useEffect(() => {
    setRoutes([]); // 種別切り替え時に前の種別のルートを描かないよう先に空へ戻す
    (async () => {
      await Promise.all([loadPrivateSpots(), loadVisits(), loadRoutes()]);
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
    // あったため、ブラウザ標準のHistory APIで直接URLだけ書き換える
    window.history.replaceState(null, "", `/${spotTypeKey}/map`);
  }, [focusSpotId, spots, spotTypeKey, runWhenMapReady]);

  // マーカーの生成・フィルタ反映。
  // 公開スポットも自分の非公開スポットも同じWebGLクラスタ表示で描画する
  // (非公開はピン画像を破線縁取りにして見分ける)。
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;

    // 表示対象のルート(と訪問順の経路)の経由地は、スポット自体のシリーズが
    // 絞り込みで外れていてもピンを表示する(別のシリーズに属する再訪スポットが、
    // 線だけ通ってピンが無い状態になるのを防ぐ)。免除するのはシリーズ条件のみで、
    // カテゴリ・訪問状況・訪問日の絞り込みは通常どおり適用する
    const routeMemberIds = new Set([
      ...filterVisibleRoutes(routes, filters, seriesStyles).flatMap((route) =>
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
            { ...filters, series: [] },
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
  // ラインと進行方向の矢印で描く。シリーズ絞り込みとの連動はfilterVisibleRoutes参照。
  // 訪問日で絞り込んでいるときは、同じ見た目で自分の訪問順の経路も重ねて描く
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const visibleRoutes = filterVisibleRoutes(routes, filters, seriesStyles);
    const visitPath = buildVisitPath(visits, filters, spotById);

    runWhenMapReady(() => {
      ensureRouteLayers(map);
      const source = map.getSource(ROUTES_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      source?.setData(
        buildRouteGeoJSON(map, visibleRoutes, seriesStyles, visitPath)
      );
    });
  }, [routes, filters, seriesStyles, runWhenMapReady, visits, spotById]);

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

  return (
    <div className="relative h-[calc(100dvh-4rem)]">
      <div ref={containerRef} className="h-full w-full" />

      {/* 検索バー・絞り込みボタン(右上のズーム/現在地ボタンと重ならないよう右側を開ける) */}
      <div className="absolute left-0 right-14 top-0 z-10 space-y-2 p-2">
        <div className="rounded-xl bg-white/95 p-2 shadow">
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
            <div className="flex items-center justify-between">
              <h2 className="font-bold">絞り込み</h2>
              <button
                type="button"
                onClick={() => setShowFilterModal(false)}
                aria-label="閉じる"
                className="text-xl leading-none text-gray-400"
              >
                ✕
              </button>
            </div>
            <FilterBar
              spots={spots}
              filters={filters}
              onChange={setFilters}
              seriesStyles={seriesStyles}
              categories={categories}
              visitDates={visitDates}
            />

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
    </div>
  );
}
