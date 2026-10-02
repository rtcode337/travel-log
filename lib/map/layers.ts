/**
 * 地図(`MapView`)のソース・レイヤーの定義と、それを足す・外す・切り替える処理。
 * 本体のピン・クラスタ・経路の線と、別種別の重ね表示のぶん。設計の理由は docs/design/map.md。
 */
import * as maplibregl from "@/lib/maplibre";
import { PIN_ICON_PAD } from "@/lib/pinIcon";

export const CLUSTER_SOURCE_ID = "spots-cluster";
export const CLUSTER_LAYER_ID = "spots-clusters";
export const CLUSTER_COUNT_LAYER_ID = "spots-cluster-count";
export const UNCLUSTERED_LAYER_ID = "spots-unclustered-point";
/** 同じ座標に複数のスポットが重なっているピンに出す重なり数のバッジ */
export const STACK_BADGE_LAYER_ID = "spots-stack-badge";
/**
 * 描いている線が通るスポット専用のソース・レイヤー。**クラスタ化しない** ——
 * GeoJSONソースの`cluster`はソース単位でしか切り替えられないので、
 * まとめたくないスポットは別のソースに分ける必要がある
 */
// 作成モードでパネルの行を押したスポットを目立たせる丸(ピンの下に敷く)。
// **クラスタ化しない自前のソース**にするので、拡大率が低くてピンがクラスタへ
// 吸われているときでも「どこを見ているか」が出る
export const FOCUS_SOURCE_ID = "spot-focus";
export const FOCUS_LAYER_ID = "spot-focus-halo";


export const PATH_PIN_SOURCE_ID = "spots-path";
export const PATH_PIN_LAYER_ID = "spots-path-point";
export const PATH_STACK_BADGE_LAYER_ID = "spots-path-stack-badge";

export const ROUTES_SOURCE_ID = "spot-routes";
export const ROUTE_LINE_LAYER_ID = "spot-routes-line";
export const ROUTE_ARROW_LAYER_ID = "spot-routes-arrow";
export const ROUTE_HIT_LAYER_ID = "spot-routes-hit";

/**
 * 別のスポット種別を半透明で重ねて表示するためのsource/layer群(本体と独立)。
 * **複数の種別を同時に重ねられる**ため、IDは種別キーごとに作る
 */
export function overlayIds(typeKey: string) {
  return {
    source: `overlay-spots:${typeKey}`,
    cluster: `overlay-clusters:${typeKey}`,
    clusterCount: `overlay-cluster-count:${typeKey}`,
    unclustered: `overlay-unclustered-point:${typeKey}`,
    stackBadge: `overlay-stack-badge:${typeKey}`,
    routeSource: `overlay-routes:${typeKey}`,
    routeLine: `overlay-routes-line:${typeKey}`,
    routeArrow: `overlay-routes-arrow:${typeKey}`,
    routeHit: `overlay-routes-hit:${typeKey}`,
  };
}

/** 重ね表示の不透明度(本体のスポットと見分けるための半透明) */
export const OVERLAY_OPACITY = 0.55;
export const OVERLAY_LINE_OPACITY = 0.45;

export const MAIN_PIN_LAYERS = [CLUSTER_LAYER_ID, UNCLUSTERED_LAYER_ID, PATH_PIN_LAYER_ID];

/** 指定した重ね表示種別のピン・クラスタのレイヤーID */
export function overlayPinLayerIds(typeKeys: string[]): string[] {
  return typeKeys.flatMap((key) => {
    const ids = overlayIds(key);
    return [ids.cluster, ids.unclustered, ids.stackBadge];
  });
}

/** 指定した重ね表示種別のルートの当たり判定レイヤーID */
export function overlayRouteHitLayerIds(typeKeys: string[]): string[] {
  return typeKeys.map((key) => overlayIds(key).routeHit);
}

/**
 * レイヤー作成済みの重ね表示種別のキーを、描画順(末尾が最上位)で保持するref。
 * クリックハンドラはレイヤー作成時に一度だけ束縛されるため、そのときどきの
 * 重ね表示の状態はこのrefを通して読む
 */
export type OverlayKeysRef = { current: string[] };

/**
 * 指定座標に、指定レイヤー群のいずれかの描画があるか(存在しないレイヤーは無視)。
 * タップの優先順位付けに使う: ①重ね表示のピン・クラスタ ②本体のピン・クラスタ
 * ③重ね表示のルート ④本体のルート の順で、上位が吸ったタップは下位に渡さない
 * (重ね表示同士は、描画順で上にある種別が優先する)
 */
export function hasFeatureAt(
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
export function higherOverlayKeys(keys: string[], typeKey: string): string[] {
  const index = keys.indexOf(typeKey);
  return index < 0 ? [] : keys.slice(index + 1);
}

/** ルートにシリーズが設定されていない(または種別の一覧に無い)ときの矢印色 */
export const DEFAULT_ROUTE_COLOR = "#2563eb";

/**
 * 訪問順の経路(選んだ日に訪問した順)の線・矢印の色。訪問済みスポットのピン
 * (`lib/pinIcon.ts`の`visited`時の塗り)と同じ緑にして「訪問済み」を連想させる。
 */
export const VISIT_PATH_COLOR = "#16a34a";

/** 訪問予定リスト(旅程)の経路の線・矢印の色。訪問順の経路(緑)・ルートと区別する紫 */
export const PLAN_LIST_PATH_COLOR = "#9333ea";

/**
 * 「現在地→訪問予定リスト先頭のスポット」の区間の線・矢印の色。
 * GeolocateControlの現在地の青丸(maplibre-gl既定の.maplibregl-user-location-dot)と
 * 同じ青にして、現在地から出ている線だと分かるようにする
 */
export const CURRENT_LOCATION_PATH_COLOR = "#1da1f2";

/**
 * ルートの進行方向を示す右向き矢印(白フチ付き)の画像を色ごとに生成して登録する。
 * symbol-placement: "line" のシンボルはライン方向に回転して置かれるため、
 * 「右向き」がそのまま巡った順の向きになる。冪等・同期
 */
export function ensureRouteArrowImage(map: maplibregl.Map, color: string): string {
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
export function ensureRouteLayers(
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
 * 重ね表示のスポット用のsource/layer。**クラスタのオン/オフで作りが変わるのは
 * ソースだけ**(GeoJSONソースの`cluster`は作成時にしか決められない)なので、
 * 切り替えは`setOverlayClusterMode`が作り直して受ける。
 * レイヤーは4枚とも常に作る —— クラスタを止めたソースには`point_count`を持つ
 * フィーチャが出てこないので、まとまりの円と件数のレイヤーは何にも一致せず、
 * 塗りの上書き(`setPaintProperty`)やクリックハンドラの登録先を分岐させずに済む。
 */
export function addOverlaySpotLayers(
  map: maplibregl.Map,
  typeKey: string,
  clustered: boolean
) {
  const ids = overlayIds(typeKey);
  map.addSource(ids.source, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
    // クラスタの有無はソース作成時にしか決められない(あとから切り替えられない)
    ...(clustered ? { cluster: true, clusterMaxZoom: 16, clusterRadius: 50 } : {}),
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

  // 同じ座標に重なっているスポットの数。**本体と同じものを重ね表示にも出す**
  // —— 重ねた種別のピンも完全に重なれば下のスポットに気づけない
  addStackBadgeLayer(map, ids.source, ids.stackBadge, clustered, OVERLAY_OPACITY);
}

/** 重ね表示のスポット用のlayer/sourceを消す(クラスタの切り替えで作り直すため) */
export function removeOverlaySpotLayers(map: maplibregl.Map, typeKey: string) {
  const ids = overlayIds(typeKey);
  // sourceを消す前に、それを参照しているlayerを全部消す
  for (const id of [ids.cluster, ids.clusterCount, ids.unclustered, ids.stackBadge]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(ids.source)) map.removeSource(ids.source);
}

/**
 * 重ね表示のクラスタ表示のオン/オフを切り替える(作り直し)。
 * **クリックハンドラは付け直さない** —— `map.on(type, layerId, ...)`はレイヤーIDで
 * 引き当てるので、同じIDで作り直せばそのまま効く(付け直すと二重に発火する)。
 * 呼び出し後は描画側が`setData`と塗りの上書きをやり直すこと(作り直した直後は空)。
 */
export function setOverlayClusterMode(
  map: maplibregl.Map,
  typeKey: string,
  clustered: boolean
) {
  removeOverlaySpotLayers(map, typeKey);
  addOverlaySpotLayers(map, typeKey, clustered);
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
export function ensureOverlayLayers(
  map: maplibregl.Map,
  typeKey: string,
  overlayKeysRef: OverlayKeysRef,
  onSelectSpot: (id: string, typeKey: string) => void,
  onSelectRoute: (routeId: string) => void,
  clustered: boolean
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

  addOverlaySpotLayers(map, typeKey, clustered);

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

  // ピンと重なり数のバッジのタップ。**バッジにも同じ処理を付ける** ——
  // 重なり数の文字はピンの右肩にずらして描くので、そこを押すとピンの当たり判定から外れる
  for (const layerId of [ids.unclustered, ids.stackBadge]) {
    map.on("click", layerId, (e) => {
      if (
        hasFeatureAt(
          map,
          e.point,
          overlayPinLayerIds(higherOverlayKeys(overlayKeysRef.current, typeKey))
        )
      ) {
        return;
      }
      // 座標はフィーチャから読まない(タイル化で丸められている)。IDだけ渡して
      // 呼び出し側が元のスポットの座標で同じ地点を引き直す(本体と同じ理由)
      const id = e.features?.[0]?.properties?.id;
      if (typeof id === "string") onSelectSpot(id, typeKey);
    });
  }

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

  for (const layerId of [
    ids.cluster,
    ids.unclustered,
    ids.stackBadge,
    ids.routeHit,
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
 * 「半透明の重ね表示が上・タップも重ね表示優先」を維持するため、描画のたびに呼ぶ)。
 * 複数種別を重ねているときは、まず全種別のルートを、続けて全種別のピンを
 * `typeKeys`の順で上げるため、どの種別のピンも全種別のルートより上になり、
 * 種別同士は配列の後ろにあるものほど上になる
 */
export function moveOverlayLayersToTop(map: maplibregl.Map, typeKeys: string[]) {
  const idsList = typeKeys.map(overlayIds);
  const ordered = [
    ...idsList.flatMap((ids) => [ids.routeLine, ids.routeArrow, ids.routeHit]),
    ...idsList.flatMap((ids) => [
      ids.cluster,
      ids.clusterCount,
      ids.unclustered,
      ids.stackBadge,
    ]),
  ];
  for (const id of ordered) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
}

/** 重ねるのをやめた種別のレイヤーを空にする(レイヤー自体は残す。上記ensure参照) */
export function clearOverlayData(map: maplibregl.Map, typeKey: string) {
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
 * ピンと重なり数のバッジのレイヤーを、指定のソースに同じ見た目で足す。
 * クラスタ用(`clustered`)は集約された点を除く filter が要る一方、
 * 経路用のソースには集約が無いので filter を付けない。
 * **2つのソースで見た目が割れないよう、レイアウトはここ1か所に置く。**
 */
export function addPinLayers(
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

  addStackBadgeLayer(map, sourceId, badgeLayerId, clustered);
}

/**
 * 座標が同じスポットが2件以上あるピンの右肩に**重なっている数**(2・3…)を出す。
 * これが無いと、下に重なっているスポットの存在に気づけない。
 * **本体と重ね表示で見た目が割れないよう、定義はここ1か所に置く** ——
 * 違うのは重ね表示が半透明(`opacity`)であることだけ。
 */
export function addStackBadgeLayer(
  map: maplibregl.Map,
  sourceId: string,
  badgeLayerId: string,
  clustered: boolean,
  opacity = 1
) {
  const notCluster: maplibregl.FilterSpecification = ["!", ["has", "point_count"]];
  const stacked: maplibregl.FilterSpecification = [">", ["get", "stack"], 1];
  map.addLayer({
    id: badgeLayerId,
    type: "symbol",
    source: sourceId,
    filter: clustered ? ["all", notCluster, stacked] : stacked,
    layout: {
      // 隠れている数(+N)ではなく**重なっている総数**を出す。ピンが何枚あるのかを
      // そのまま読めるほうが分かりやすい(1件のときは filter で出さない)
      "text-field": ["to-string", ["get", "stack"]],
      "text-font": ["Noto Sans Regular"],
      "text-size": 11,
      "text-anchor": "bottom",
      // 単位は文字サイズ(em)。**ピンに少し重ねて置く** —— 右へ離すと、隣のピンの
      // ほうへ寄って「どのピンの数か」が読み取りにくくなる
      "text-offset": [0.9, -1.6],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "#1f2937",
      "text-halo-width": 2,
      "text-opacity": opacity,
    },
  });
}

/** クラスタ用のsource/layerを(まだなければ)追加する。冪等 */
export function ensureClusterLayers(
  map: maplibregl.Map,
  overlayKeysRef: OverlayKeysRef,
  /** 押されたピンのID(同じ地点に何件あるかは呼び出し側が解決する) */
  onSelectSpot: (id: string) => void
) {
  if (map.getSource(CLUSTER_SOURCE_ID)) return;

  // フォーカスの丸を先に作る —— 後から足すクラスタ・ピンのレイヤーが上に乗るので、
  // ピンを隠さずその足元に敷ける
  map.addSource(FOCUS_SOURCE_ID, {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: FOCUS_LAYER_ID,
    type: "circle",
    source: FOCUS_SOURCE_ID,
    paint: {
      // 拡大率で大きさを変える(遠くでは小さく、近くではピンを囲む大きさに)
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 10, 16, 22],
      "circle-color": "#2563eb",
      "circle-opacity": 0.2,
      "circle-stroke-width": 3,
      "circle-stroke-color": "#2563eb",
      "circle-stroke-opacity": 0.9,
    },
  });

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
  // ピンと重なり数のバッジのタップ。**押されたピンの座標をそのまま渡す** ——
  // 同じ地点に何件あるかの解決は呼び出し側(表示中のスポットを持っている側)に任せる。
  // ここで`queryRenderedFeatures`から拾うと**描かれているピンしか数えられず**、
  // 拡大率が低いときに相方がクラスタへ吸われているとバッジの数と食い違う
  // (バッジの数は表示中の全スポットで数えているため)。
  // バッジにも同じ処理を付ける —— 重なり数の文字はピンの右肩にずらして描くので、
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

  for (const layerId of [
    CLUSTER_LAYER_ID,
    UNCLUSTERED_LAYER_ID,
    PATH_PIN_LAYER_ID,
  ]) {
    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  }
}

export function showClusterLayers(map: maplibregl.Map) {
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
