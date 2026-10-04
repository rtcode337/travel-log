"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useId } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PlanBuildPanel from "@/components/PlanBuildPanel";
import HelpTip from "@/components/HelpTip";
import LinkedText from "@/components/LinkedText";
import GoogleSpotLinks from "@/components/GoogleSpotLinks";
import WeatherAskLink from "@/components/WeatherAskLink";
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
import { DEFAULT_REGION_SCOPE } from "@/lib/region";
import { countedVisits, getSpotTypeSetting, SPOT_ADMIN_ROLES } from "@/lib/types";
import type {
  FlaggedSpot,
  Role,
  Spot,
  SpotRoute,
  SpotType,
  Visit,
  VisitPlanList,
} from "@/lib/types";
import { expandSpot, readSpotCacheDb } from "@/lib/spotCacheDb";
import { autoTextColor, resolveSeriesStyles } from "@/lib/seriesStyle";
import { resolveCategories } from "@/lib/category";
import { resolveSpotFace, resolveSpotMark, resolveSpotShape } from "@/lib/spotStyle";
import { formatSpotMeta } from "@/lib/spotMeta";
import { planWeatherDate } from "@/lib/weather";
import { useSpotsWeather } from "@/lib/useSpotsWeather";
import { ensurePinImage } from "@/lib/pinIcon";
import {
  downloadSpotCacheFor,
  formatDownloadedAt,
  useSpotCache,
  type DownloadProgress,
} from "@/lib/useSpotCache";
import { useDragReorder, REORDER_HANDLE_CLASS } from "@/lib/useDragReorder";
import { useRankEnabled } from "@/lib/useRankEnabled";
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
} from "@/components/FilterBar";
import AddSpotModal from "@/components/AddSpotModal";
import SpotDetailModal from "@/components/SpotDetailModal";
import VisitDateCalendar from "@/components/VisitDateCalendar";
import SpotDownloadDialogs, { DownloadProgressDialog } from "@/components/SpotDownloadDialogs";
import GoogleMapsRouteLink from "@/components/GoogleMapsRouteLink";
import SpotBadge from "@/components/SpotBadge";
import LoadErrorBanner from "@/components/LoadErrorBanner";
import {
  CLUSTER_SOURCE_ID,
  FOCUS_SOURCE_ID,
  PATH_PIN_SOURCE_ID,
  ROUTES_SOURCE_ID,
  overlayIds,
  VISIT_PATH_COLOR,
  PLAN_LIST_PATH_COLOR,
  CURRENT_LOCATION_PATH_COLOR,
  ensureRouteLayers,
  setOverlayClusterMode,
  ensureOverlayLayers,
  moveOverlayLayersToTop,
  clearOverlayData,
  ensureClusterLayers,
  showClusterLayers,
  MARKER_TAP_CLASS,
} from "@/lib/map/layers";
import {
  filterVisibleRoutes,
  visitedSpotIdsOn,
  buildVisitPathsByDay,
  buildPlanListPath,
  buildRouteGeoJSON,
  stackKey,
  visitedPinOf,
  countStacks,
  buildClusterGeoJSON,
} from "@/lib/map/geojson";
import {
  todayKey,
  oneYearAgoKey,
  effectiveIsolate,
  loadSavedFilters,
  saveFilters,
  loadSavedOverlayTypeKeys,
  saveOverlayTypeKeys,
} from "@/lib/map/filterStorage";
import Modal from "@/components/Modal";

/**
 * 直前に表示していた地図の中心・ズームをスポット種別ごとに覚えておく
 * (モジュールスコープの変数なので他画面へ遷移してMapViewがアンマウントされても、
 * 同じセッション内であれば保持される)。これがあれば再訪時は現在地取得をせず
 * そのまま復元し、なければ(このセッションで初めてその種別の/mapを開いたとき)
 * 初期表示の決定(日本の種別は現在地取得、それ以外はスポット全体へのフィット)に進む。
 * 種別ごとに分けるのは、種別を跨いだ行き来のあとで戻ってきたときに、その種別で
 * 最後に見ていた場所が出るようにするため。
 * **種別チップのメニューで切り替えるときだけは、いま見ている場所を切り替え先へ
 * 書き写す**(`carryViewTo`) —— 切り替えは「同じ場所を別の種別で見たい」ことが
 * 多く、切り替え先の古い記憶や初期表示(現在地・スポット全体)へ飛ぶと、
 * どこを見ていたのか分からなくなる。
 */
const lastViews = new Map<string, { center: [number, number]; zoom: number }>();

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
  // ラベルと入力欄を結ぶid(同じ画面に同じ部品が複数出ても重ならないように)
  const fid = useId();
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusSpotId = searchParams.get("spot");
  // /map?buildList=1 で開かれたら、訪問予定リスト作成モードに入る(下書きをlocalStorageから読む)
  const buildListParam = searchParams.get("buildList");
  // 「◯◯」の地図で開くリンク(重ね表示のスポット詳細)で種別を切り替えて来たとき、
  // 元の種別のキーがfromに入る。左下に「元の地図に戻る」リンクを出すのに使う
  // (戻り先の表示位置は種別ごとのlastViewsが復元するため、キーだけあればよい)
  const returnTypeKey = searchParams.get("from");
  // /map?planList=<id> で開かれたら、そのリストを経路の対象に選ぶ
  // (スポット一覧の訪問予定リスト詳細「このリストを地図で表示」からの遷移)
  const focusPlanListId = searchParams.get("planList");
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
  // 訪問順の矢印(buildVisitPathsByDay)に訪問日時が要るため、IDの集合ではなく全件を持つ
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
  // 訪問順の経路(buildVisitPathsByDay)・訪問日の選択肢は日時ありの未訪問記録も含むため、
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
  const visitDateOptions = useMemo(
    () => ({ today: todayKey(), oneYearAgo: oneYearAgoKey() }),
    []
  );
  // 訪問日セクションの2つのトグルの状態。**別々の軸**で、片方が対象の期間を、
  // もう片方が他のスポットを隠すかどうかを決める(同時に点けられる)。
  const isolatingVisit = filters.isolate === "visit";
  // 対象日がちょうど「1年前〜今日」か=「過去1年」が点いているか。
  // **期間そのものを見て決める**ので、カレンダーで同じ期間を選んだときも点く
  // (実際にその期間なので嘘にはならない)。専用のフラグを持つと、
  // カレンダー側の選択と食い違ったときにどちらが正しいのか決められなくなる
  const isPastYearRange =
    filters.visitedDate === visitDateOptions.oneYearAgo &&
    filters.visitedDateTo === visitDateOptions.today;
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
  /**
   * 同じ座標に重なっているスポットの選択一覧。`overlayTypeKey`がnullなら本体の
   * スポット、そうでなければその重ね表示種別のスポット
   * (名前・バッジの解決先と、選んだときの開き方が変わる)
   */
  const [stack, setStack] = useState<{
    ids: string[];
    overlayTypeKey: string | null;
  } | null>(null);
  /** 一覧から詳細へ進んだときの戻り先。詳細を閉じると一覧に戻す ——
   *  重なったピンは地図から開き直せないので、閉じたら選ぶところからやり直しになる */
  const [stackReturn, setStackReturn] = useState<{
    ids: string[];
    overlayTypeKey: string | null;
  } | null>(null);
  /** 「この地点のスポット」に出す簡単な住所。座標をキーに覚えておき、
   *  同じ地点を開き直したときにNominatimへ問い合わせ直さない(1秒1回の利用条件があるため) */
  const [stackAddress, setStackAddress] = useState<string | null>(null);
  const stackAddressCacheRef = useRef<Map<string, string>>(new Map());
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
  const [savingList, setSavingList] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);
  // 作成モードのパネルで押した行のスポット。地図をそこへ寄せ、丸を敷いて目立たせる
  // (どのピンが一覧のどの行なのかは、名前だけでは地図の上で見つけられないため)
  const [focusedBuildSpotId, setFocusedBuildSpotId] = useState<string | null>(null);
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
    // 作成モードを抜けたらフォーカスの丸も消す(地図に置き去りにしない)
    if (buildDraft === null) setFocusedBuildSpotId(null);
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
   * 地図でピン(または重なり数のバッジ)を押したとき。**同じ座標のスポットは
   * 表示中の全件から引き直す** —— 描かれているピンだけを見ると、拡大率が低くて
   * 相方がクラスタに吸われているときに1件しか見つからず、バッジの数と食い違う。
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
      if (ids.length > 1) setStack({ ids, overlayTypeKey: null });
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

  /**
   * 種別を切り替えるとき、**いま見ている場所を切り替え先の記憶(`lastViews`)へ
   * 書き写す**。切り替え先は自分の記憶を持っていればそこ・持っていなければ
   * 初期表示(現在地の取得 or スポット全体へのフィット)へ飛んでいたので、
   * 「同じ場所を別の種別で見たい」(この地図に何があるかを比べたい)という
   * 切り替えの動機と食い違っていた。
   * **書き込むのは切り替え先のキー**で、いまの種別の記憶は地図の後片付け
   * (`saveView`)がそのまま残す —— 戻ってきたときに同じ場所が出るのは変わらない。
   */
  const carryViewTo = useCallback((targetTypeKey: string) => {
    const map = mapRef.current;
    if (!map) return;
    lastViews.set(targetTypeKey, {
      center: map.getCenter().toArray() as [number, number],
      zoom: map.getZoom(),
    });
  }, []);
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
  /**
   * 重ね表示種別ごとの、いま作ってあるレイヤーのクラスタ有無。
   * GeoJSONソースの`cluster`は作成時にしか決められないので、設定が変わったかを
   * これで見て`setOverlayClusterMode`が作り直す
   */
  const overlayClusteredRef = useRef<Map<string, boolean>>(new Map());
  /**
   * 重ね表示種別ごとの、いま地図に描いているスポット。バッジを押したときに
   * 同じ地点のスポットを引き直すのに使う(本体の`displayedSpotsRef`と同じ役割)。
   * **描かれているピンから数えてはいけない** —— 拡大率が低いと相方がクラスタへ
   * 吸われていてバッジの数と食い違う
   */
  const overlayDisplayedRef = useRef<Map<string, Spot[]>>(new Map());

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
  const openOverlaySpot = useCallback((id: string) => {
    if (buildModeRef.current) setAddCandidate(id);
    else setOverlayDetailSpotId(id);
  }, []);

  /**
   * 重ね表示のピン(と重なり数のバッジ)のタップ。本体と同じく、**押されたスポット
   * 自身の座標**でその種別の表示中スポットを引き直し、2件以上なら一覧を出す
   * (描かれているピンから数えると、クラスタへ吸われている相方を数え落とす)
   */
  const handleOverlaySpotSelect = useCallback(
    (id: string, typeKey: string) => {
      const shown = overlayDisplayedRef.current.get(typeKey) ?? [];
      const clicked = shown.find((spot) => spot.id === id);
      const ids = clicked
        ? shown
            .filter((spot) => stackKey(spot) === stackKey(clicked))
            .map((spot) => spot.id)
        : [id];
      if (ids.length > 1) setStack({ ids, overlayTypeKey: typeKey });
      else openOverlaySpot(id);
    },
    [openOverlaySpot]
  );

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
   * 確認ダイアログで説明を出すために取り直した全項目。
   * **公開スポットは手元の値では足りない** —— IndexedDBキャッシュは容量のため
   * `description`を保存しておらず、`expandSpot`が空文字のプレースホルダーを
   * 入れて返すため(`lib/spotCacheDb.ts`)。
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
  // Geminiへの質問に添える種別(取り直しが済むまではnull=種別なしで組む)
  const addCandidateSpotType = useMemo(
    () =>
      spotTypes.find((t) => t.id === addCandidateDetail?.spot_type_id) ?? null,
    [spotTypes, addCandidateDetail]
  );
  const closeAddCandidate = useCallback(() => {
    setAddCandidate(null);
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

  // パネルの行を押したときに、そのスポットへ地図を寄せる。**今より引かない**
  // (十分寄っているのにズームを固定すると、押すたびに縮尺が飛ぶ)
  const focusBuildSpot = useCallback(
    (spotId: string) => {
      setFocusedBuildSpotId(spotId);
      const map = mapRef.current;
      const spot = buildPanelSpotById.get(spotId);
      if (!map || !spot) return;
      runWhenMapReady(() =>
        map.flyTo({
          center: [spot.lng, spot.lat],
          zoom: Math.max(map.getZoom(), 15),
        })
      );
    },
    [buildPanelSpotById, runWhenMapReady]
  );

  // フォーカスの丸。押した行のスポットの足元に1つだけ敷く
  // (座標が手元に無いスポットは敷けないので空にする)
  useEffect(() => {
    const spot = focusedBuildSpotId
      ? buildPanelSpotById.get(focusedBuildSpotId)
      : undefined;
    runWhenMapReady(() => {
      const source = mapRef.current?.getSource(FOCUS_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      source?.setData({
        type: "FeatureCollection",
        features: spot
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "Point", coordinates: [spot.lng, spot.lat] },
              },
            ]
          : [],
      });
    });
  }, [focusedBuildSpotId, buildPanelSpotById, runWhenMapReady]);

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: spotTypesはメッセージの表示名にしか使わないので、変わっても読み直さない
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
  // 取得に失敗したとき、手元の一覧を空で上書きせずに理由を出す(「0件」に見せない)
  const [dataError, setDataError] = useState<string | null>(null);

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
  // 追加の依頼(「ここにスポット追加を依頼」。spot_admin/adminのみ)。スポットを作るのではなく、
  // 「ここに足りない」を管理画面の「修正・追加の依頼」に残す
  const [addRequestAt, setAddRequestAt] = useState<{ lat: number; lng: number } | null>(
    null
  );
  const [addRequestReason, setAddRequestReason] = useState("");
  const [addRequestSaving, setAddRequestSaving] = useState(false);
  const [addRequestError, setAddRequestError] = useState<string | null>(null);
  const [addRequestNotice, setAddRequestNotice] = useState<string | null>(null);
  // 自分が出した修正・追加の依頼。片付くまで地図に印を出す —— 追加の依頼は
  // スポットが無い場所なので地図に何も残らず、修正の依頼もピンの見た目は変わらない
  // ので、どこに頼んだか・もう頼んだかが地図から分からなくなる
  const [myRequests, setMyRequests] = useState<FlaggedSpot[]>([]);
  const requestMarkersRef = useRef<maplibregl.Marker[]>([]);
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

  const loadMyRequests = useCallback(async () => {
    const { data } = await api.spotFlags.mine(spotTypeKey);
    setMyRequests(data ?? []);
  }, [spotTypeKey]);

  // 依頼を出せるのはspot_admin/adminだけなので、それ以外は問い合わせない
  useEffect(() => {
    if (!role || !SPOT_ADMIN_ROLES.includes(role)) {
      setMyRequests([]);
      return;
    }
    loadMyRequests();
  }, [role, loadMyRequests]);



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
    overlayClusteredRef.current.clear();
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
    // **windowから引いて存在を確かめる。** WebKitは方位センサーのAPIを安全な
    // コンテキスト(HTTPSかlocalhost)でしか定義しないため、LAN内のhttp://で開いた
    // 実機では素の`DeviceOrientationEvent`参照がReferenceErrorになり、
    // ("Can't find variable: DeviceOrientationEvent")地図の初期化ごと落ちる
    const orientationApi = (
      window as unknown as {
        DeviceOrientationEvent?: {
          requestPermission?: () => Promise<"granted" | "denied">;
        };
      }
    ).DeviceOrientationEvent;
    const handleContainerClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(".maplibregl-ctrl-geolocate")) return;
      orientationApi
        ?.requestPermission?.()
        .then((res) => {
          if (res === "granted") startOrientation();
        })
        .catch(() => {});
    };
    if (typeof orientationApi?.requestPermission === "function") {
      map.getContainer().addEventListener("click", handleContainerClick, true);
    } else {
      // 許可が不要な環境(Android / PC)は初めから購読しておく。
      // APIが無い環境(http://で開いたiOSなど)でも購読自体は無害
      // (イベントが来ないだけ)なので、分岐を増やさずそのまま通す
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
    const { data, error } = await api.visits.list();
    if (error) return setDataError(error.message);
    setVisits(data ?? []);
  };
  const loadPlanLists = async () => {
    const { data, error } = await api.visitPlanLists.list(spotTypeKey);
    if (error) return setDataError(error.message);
    setPlanLists(data ?? []);
  };
  const loadHides = async () => {
    const { data, error } = await api.spotHides.list();
    if (error) return setDataError(error.message);
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
    const { data, error } = await api.spots.list("private", { type: spotTypeKey });
    if (error) return setDataError(error.message);
    setPrivateSpots(data ?? []);
  }, [spotTypeKey]);

  // データ取得(公開スポット・公開ルートはspotCacheが読み込む)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 種別が変わったときだけ読み直す(読み込み関数は描画のたびに作り直されるので、依存に入れると読み続ける)
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

  // /map?planList= の処理。リストの読み込みを待ってから、そのリストを経路の対象に選び、
  // 経路全体が入るよう移動する。**一度だけ**実行する
  // (以後は普通の絞り込みと同じで、利用者が変えたものを上書きしない)。
  // ?spot= と同様に、処理したらURLからパラメータを消す
  //
  // **「これだけを表示」にはしない。** 経路の周りに何があるかを見ながら旅程を
  // 確かめたいので、他のスポットを消すと寄り道の候補を足せない。絞り込みモーダルの
  // 訪問予定リストのセクションで切り替えられるので、必要な人はそこで入れる。
  // 前回の絞り込みに残っていた「これだけを表示」も、リスト側のものは解除する
  // (訪問日側の`"visit"`はこの遷移と関係が無いので触らない)
  const appliedPlanListRef = useRef<string | null>(null);
  useEffect(() => {
    if (!focusPlanListId || planLists.length === 0) return;
    if (appliedPlanListRef.current === focusPlanListId) return;
    const list = planLists.find((l) => l.id === focusPlanListId);
    if (!list) return; // 別の種別のリスト・削除済みなら何もしない(URLだけは下で消す)
    appliedPlanListRef.current = focusPlanListId;
    const next: SpotFilters = {
      ...filters,
      planListId: list.id,
      isolate: filters.isolate === "plan" ? null : filters.isolate,
    };
    setFilters(next);
    runWhenMapReady(() =>
      fitMapToSpots(buildPlanListPath(planLists, next, pathSpotById))
    );
  }, [
    focusPlanListId,
    planLists,
    filters,
    pathSpotById,
    setFilters,
    fitMapToSpots,
    runWhenMapReady,
  ]);

  // 見つからないリストIDでもURLは片付ける(戻る操作やリストの取り直しで再発火しないように)
  useEffect(() => {
    if (!focusPlanListId || planLists.length === 0) return;
    window.history.replaceState(
      null,
      "",
      returnTypeKey
        ? `/${spotTypeKey}/map?from=${encodeURIComponent(returnTypeKey)}`
        : `/${spotTypeKey}/map`
    );
  }, [focusPlanListId, planLists, spotTypeKey, returnTypeKey]);

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: クリックのハンドラ(handleMapSpotSelect)はレイヤーを作るときに一度だけ束ねる(作り直すと二重に発火する)。描き直しの合図は下の配列で決める
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
    // **訪問日の「これだけを表示」中は絞り込みを効かせない。** その日に訪問した
    // スポットは必ず訪問済みで、訪問状況の既定(未訪問のみ)と必ずぶつかるため、
    // 絞り込みを重ねると「その日の経路だけを見たい」のに線だけが残る。
    // 対象は日付で決まっていて曖昧さが無いので、選んだ日の訪問を全部出す
    const skipFiltersInIsolate = isolate === "visit";
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
        (skipFiltersInIsolate ||
          passesFilters(
            filters,
            spot.series,
            spot.categories,
            visitedIds.has(spot.id),
            spot.rank
          ))
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
            visitedPinOf(spot.id, visitedIds, filters.showVisitedOriginalPin),
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
        buildClusterGeoJSON(
          offPath,
          visitedIds,
          seriesStyles,
          rankEnabled,
          stacks,
          filters.showVisitedOriginalPin
        )
      );
      const pathSource = map.getSource(PATH_PIN_SOURCE_ID) as
        | maplibregl.GeoJSONSource
        | undefined;
      pathSource?.setData(
        buildClusterGeoJSON(
          onPath,
          visitedIds,
          seriesStyles,
          rankEnabled,
          stacks,
          filters.showVisitedOriginalPin
        )
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
      // 訪問日の「これだけを表示」中は絞り込みを効かせない(本体と同じ扱い)
      const skipFiltersInIsolate = isolate === "visit";
      const active = overlayTypeKeys;
      // 選択が外れた(・注視で消した)種別は、作成済みレイヤーのデータを空にする
      // (レイヤー自体は残しても害がない。ensureOverlayLayers参照)
      for (const key of createdOverlayKeysRef.current) {
        if (!active.includes(key)) {
          clearOverlayData(map, key);
          overlayDisplayedRef.current.delete(key);
        }
      }

      const render = async () => {
        for (const typeKey of active) {
          const data = overlayData.get(typeKey);
          // キャッシュ読み込み前・ダウンロード確認中の種別は、まだ何も描かない
          if (!data) {
            if (createdOverlayKeysRef.current.has(typeKey)) {
              clearOverlayData(map, typeKey);
              overlayDisplayedRef.current.delete(typeKey);
            }
            continue;
          }
          const typeFilters = overlayFilters.get(typeKey) ?? DEFAULT_FILTERS;
          // クラスタ表示のオン/オフは重ね先の種別の設定に従う(本体とは独立)
          const clustered = !typeFilters.disableCluster;
          ensureOverlayLayers(
            map,
            typeKey,
            overlayKeysRef,
            handleOverlaySpotSelect,
            setOverlayDetailRouteId,
            clustered
          );
          // 設定が変わったらソースごと作り直す(clusterは作成時にしか決められない)。
          // 直後のsetDataと塗りの上書きで中身は入り直す
          if (
            createdOverlayKeysRef.current.has(typeKey) &&
            overlayClusteredRef.current.get(typeKey) !== clustered
          ) {
            setOverlayClusterMode(map, typeKey, clustered);
          }
          createdOverlayKeysRef.current.add(typeKey);
          overlayClusteredRef.current.set(typeKey, clustered);

          const ids = overlayIds(typeKey);
          const styles = overlaySeriesStylesOf(typeKey);
          const overlayRank = overlayRankEnabledOf(typeKey);
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
              (skipFiltersInIsolate ||
                passesFilters(
                  typeFilters,
                  spot.series,
                  spot.categories,
                  visitedIds.has(spot.id),
                  spot.rank
                ))
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
          // キャッシュには公開スポットしか入らないため、非公開(破線)のピンは不要。
          // 「訪問済みも元のピンで表示」は重ね表示側の絞り込みには出さない設定なので、
          // 今開いている地図(本体)の値をそのまま効かせる(同じ地図の中で片方だけ
          // 緑+✓になると見え方が割れるため)
          const visitedPin = (spotId: string) =>
            visitedPinOf(spotId, visitedIds, filters.showVisitedOriginalPin);
          await Promise.all(
            filtered.map((spot) =>
              ensurePinImage(
                map,
                resolveSpotFace(spot.rank, spot.series, styles, overlayRank),
                resolveSpotMark(spot.series, styles),
                resolveSpotShape(spot.series, styles),
                visitedPin(spot.id),
                false
              )
            )
          );
          if (cancelled) return;
          overlayDisplayedRef.current.set(typeKey, filtered);
          (
            map.getSource(ids.source) as maplibregl.GeoJSONSource | undefined
          )?.setData(
            buildClusterGeoJSON(
              filtered,
              visitedIds,
              styles,
              overlayRank,
              countStacks(filtered),
              filters.showVisitedOriginalPin
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

  // 自分の依頼の印。未依頼は破線、対応中(渡した)は実線。
  // - 修正の依頼: スポットの座標(ピンの先端)を囲む黄色の輪。**タップは素通し**
  //   にしてピンをそのまま押せるようにする(理由はスポット詳細に出る)。ピンの
  //   大きさはランクで変わるので、頭に札を載せるより先端を囲むほうがずれない
  // - 追加の依頼: 緑の「+」。タップで理由と状態を出し、その場で取り消せる。
  //   指す先のスポットが無いので、ここで取り消せないと管理画面の一覧まで
  //   探しに行くことになる(地図で「これは要らなかった」と気づくのはこの場面)
  //   **タップは印が受け取る**(MARKER_TAP_CLASS)。後ろにスポットのピンがあっても
  //   そちらの詳細は開かない
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    requestMarkersRef.current.forEach((m) => m.remove());
    requestMarkersRef.current = [];

    for (const f of myRequests) {
      const state = f.forwarded_at ? "対応中" : "未依頼";
      const border = f.forwarded_at ? "solid" : "dashed";
      // 修正の依頼と位置確認(位置は正しい)は、スポットのピンを輪で囲む。
      // 位置確認は直してほしい依頼ではないので、色を分ける
      if (f.kind === "fix" || f.kind === "confirm") {
        const [fill, stroke] = f.kind === "confirm" ? ["#bae6fd66", "#0284c7"] : ["#fde68a66", "#d97706"];
        const ring = document.createElement("div");
        ring.style.cssText = `
          width: 30px; height: 30px; border-radius: 50%; pointer-events: none;
          background: ${fill}; border: 3px ${border} ${stroke};
          box-shadow: 0 0 0 2px #ffffffcc;
        `;
        const marker = new maplibregl.Marker({ element: ring })
          .setLngLat([f.lng, f.lat])
          .addTo(map);
        requestMarkersRef.current.push(marker);
        continue;
      }
      const el = document.createElement("div");
      el.title = `スポット追加を依頼中(${state})`;
      el.textContent = "+";
      el.className = MARKER_TAP_CLASS;
      el.style.cssText = `
        width: 20px; height: 20px; border-radius: 50%; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        font: bold 14px/1 sans-serif; color: #15803d;
        background: #dcfce7cc;
        border: 2px ${border} #16a34a;
      `;
      // 理由は利用者の入力なので、HTMLとしてではなくテキストとして入れる
      const body = document.createElement("div");
      body.style.cssText = "font-size: 12px; max-width: 220px; white-space: pre-wrap;";
      const head = document.createElement("div");
      head.style.fontWeight = "bold";
      head.textContent = `スポット追加を依頼中(${state})`;
      body.appendChild(head);
      if (f.reason) {
        const reason = document.createElement("div");
        reason.textContent = f.reason;
        body.appendChild(reason);
      }
      const cancel = document.createElement("button");
      cancel.type = "button";
      cancel.textContent = "依頼を取り消す";
      cancel.style.cssText = `
        margin-top: 6px; padding: 2px 8px; font-size: 12px; cursor: pointer;
        color: #b91c1c; background: #fff; border: 1px solid #fca5a5; border-radius: 4px;
      `;
      const failure = document.createElement("div");
      failure.style.cssText = "margin-top: 4px; color: #b91c1c;";
      cancel.addEventListener("click", async () => {
        cancel.disabled = true;
        cancel.textContent = "取り消しています…";
        failure.textContent = "";
        const { error } = await api.spotFlags.delete(f.id);
        if (error) {
          cancel.disabled = false;
          cancel.textContent = "依頼を取り消す";
          failure.textContent = "取り消せませんでした: " + error.message;
          return;
        }
        // 読み直すと印ごと描き直され、ポップアップも一緒に消える
        loadMyRequests();
      });
      body.appendChild(cancel);
      body.appendChild(failure);
      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([f.lng, f.lat])
        .setPopup(new maplibregl.Popup({ offset: 14 }).setDOMContent(body))
        .addTo(map);
      requestMarkersRef.current.push(marker);
    }
  }, [myRequests, loadMyRequests]);

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
      /** 天気のリンクに渡すスポット。**訪問予定リストのときだけ入る** ——
       *  ルートと訪問順は済んだ話で、これから行く日が無い(天気を聞く意味が無い) */
      weatherSpot?: Spot;
    }[];
    /** 天気を聞く日(訪問予定リストのときだけ)。開始日→終了日。
     *  訪問日未定のリストはnullで、その場合は天気を出さない */
    weatherDate?: string | null;
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
                weatherSpot: s,
              })),
              weatherDate: planWeatherDate(list),
            };
          })()
        : null;
  // 経路詳細に並ぶ地点の、予定の日の予報。**リスト詳細と同じくまとめて1回で引く**
  // (訪問予定リスト以外の経路には weatherSpot が無いので、対象は空になる)
  const weatherBySpot = useSpotsWeather(
    routeDetailView?.points.flatMap((p) =>
      p.weatherSpot ? [{ id: p.weatherSpot.id, lat: p.lat, lng: p.lng }] : []
    ) ?? [],
    routeDetailView?.weatherDate ?? null
  );

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
  // ?from=付きで来たときの戻り先。spotTypesに見つかる種別だけリンク化する
  // (不正なキー・閲覧できない種別はここで弾かれる)。**いまこのパラメータを付ける
  // 導線はアプリ側に無い**(スポット詳細の「「◯◯」の地図で開く」を外したため)が、
  // 共有・ブックマークされたURLでも戻れるように受ける側は残してある
  const returnType =
    returnTypeKey && returnTypeKey !== spotTypeKey
      ? spotTypes.find((t) => t.key === returnTypeKey) ?? null
      : null;

  // 「この地点のスポット」を開いたら、その座標の簡単な住所を1回だけ引く。
  // **一覧の1件目の座標**で引く(同じ地点に積まれているのでどれでも同じ)。
  // 失敗しても黙って出さない —— 住所は補助の情報で、無くても一覧は読める
  useEffect(() => {
    if (!stack) {
      setStackAddress(null);
      return;
    }
    const spot = (stack.overlayTypeKey ? overlaySpotById : spotById).get(stack.ids[0]);
    if (!spot) return;
    const key = `${spot.lat.toFixed(6)},${spot.lng.toFixed(6)}`;
    const cached = stackAddressCacheRef.current.get(key);
    if (cached !== undefined) {
      setStackAddress(cached);
      return;
    }
    let alive = true;
    api.geocode
      .reverse(spot.lat, spot.lng, regionScope ?? DEFAULT_REGION_SCOPE)
      .then(({ data }) => {
        const address = data?.address ?? null;
        if (address) stackAddressCacheRef.current.set(key, address);
        if (alive) setStackAddress(address);
      })
      .catch(() => {
        // 通信に失敗しても一覧は読めるので黙って住所だけ出さない
      });
    return () => {
      alive = false;
    };
  }, [stack, spotById, overlaySpotById, regionScope]);

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
                      onClick={() => {
                        carryViewTo(t.key);
                        setShowTypeMenu(false);
                      }}
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
        <Modal
          onClose={() => setShowVisitCalendar(false)}
          zIndexClassName="z-[60]"
          panelClassName="max-h-[85dvh] w-full max-w-xs space-y-2 overflow-y-auto rounded-2xl bg-white p-4"
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
        </Modal>
      )}

      {/* 絞り込みモーダル */}
      {showFilterModal && (
        <Modal
          onClose={() => setShowFilterModal(false)}
          panelClassName="max-h-[85dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-4"
        >
          <div className="flex items-center justify-between gap-2">
            {/* 節の見出しは全部同じ大きさにする —— 絞り込みは訪問日や表示に
                掛かっているわけではなく、並んだ節の1つでしかない */}
            <h2 className="text-sm font-medium">絞り込み</h2>
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
                {/* 対象日を1年前〜今日にするトグル。押すだけで期間の選択が要らない
                    (カレンダーだと開始月まで12回さかのぼって2回タップになる)。
                    **「これだけを表示」とは別の軸**で、こちらが決めるのは対象の期間、
                    あちらが決めるのは他のスポットを隠すかどうか。
                    両方を同時に点けられる(過去1年に訪問したスポットだけを出す)。
                    解除すると既定=今日へ戻す —— 期間だけが1年のまま残ると、
                    1年ぶんの訪問が1本の経路として繋がって読めなくなる */}
                <button
                  type="button"
                  aria-pressed={isPastYearRange}
                  onClick={() =>
                    handleSelectVisitDate(
                      isPastYearRange
                        ? visitDateOptions.today
                        : visitDateOptions.oneYearAgo,
                      isPastYearRange ? null : visitDateOptions.today
                    )
                  }
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                    isPastYearRange
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-500"
                  }`}
                >
                  過去1年
                </button>
                {/* その日のスポットだけに絞る(他のスポット・ルート・訪問予定リストは隠す) */}
                <button
                  type="button"
                  disabled={!filters.visitedDate}
                  aria-pressed={isolatingVisit}
                  onClick={() =>
                    setFilters({
                      ...filters,
                      isolate: isolatingVisit ? null : "visit",
                    })
                  }
                  className={`shrink-0 rounded-full border px-2.5 py-0.5 text-xs font-medium disabled:opacity-40 ${
                    isolatingVisit
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
            <p className="mb-2 flex items-center gap-1.5 text-sm font-medium">
              表示
              <HelpTip>
                {routes.length > 0 && "経路は巡った順の矢印です。"}
                クラスタ表示を無効にすると、近くのピンを「N件」の丸にまとめず1件ずつ
                出します(件数が多い種別では地図が重くなります)。
                「訪問済みも元のピンで表示」をオンにすると、訪問済みのスポットも緑+✓では
                なくランク・シリーズの見た目のまま表示します(重ねている種別のピンにも
                効きます)。
              </HelpTip>
            </p>
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
              <button
                type="button"
                aria-pressed={filters.showVisitedOriginalPin}
                onClick={() =>
                  setFilters({
                    ...filters,
                    showVisitedOriginalPin: !filters.showVisitedOriginalPin,
                  })
                }
                className={`rounded-full border px-3 py-1 text-sm font-medium ${
                  filters.showVisitedOriginalPin
                    ? "border-blue-600 bg-blue-600 text-white"
                    : "border-gray-300 bg-white text-gray-400"
                }`}
              >
                訪問済みも元のピンで表示
              </button>
            </div>
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
        </Modal>
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
            <Modal
              onClose={() => setOverlayFilterTypeKey(null)}
              zIndexClassName="z-[60]"
              panelClassName="max-h-[85dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-4"
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
              {/* 地図の見せ方の切り替え(絞り込みではない)。本体の絞り込みパネルの
                  「表示」の節と同じ扱いで、重ね表示側にも要る —— 重ねた種別のピンが
                  「N件」の丸にまとまったままだと、本体のピンとの位置関係が読めない。
                  「訪問済みも元のピンで表示」は本体の値を種別をまたいで効かせる設定
                  なので、ここには出さない */}
              <div className="border-t border-gray-100 pt-3">
                <p className="mb-2 text-sm font-medium">表示</p>
                <button
                  type="button"
                  aria-pressed={typeFilters.disableCluster}
                  onClick={() =>
                    setOverlayFiltersAndSave(typeKey, {
                      ...typeFilters,
                      disableCluster: !typeFilters.disableCluster,
                    })
                  }
                  className={`rounded-full border px-3 py-1 text-sm font-medium ${
                    typeFilters.disableCluster
                      ? "border-blue-600 bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-400"
                  }`}
                >
                  クラスタ表示を無効化
                </button>
              </div>
            </Modal>
          );
        })()}

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/60">
          <p className="text-sm text-gray-600">読み込み中…</p>
        </div>
      )}

      {dataError && (
        <LoadErrorBanner
          message={dataError}
          onRetry={() => {
            setDataError(null);
            loadPrivateSpots();
            loadVisits();
            loadPlanLists();
            loadHides();
          }}
          className="absolute inset-x-2 top-16 z-30 mx-auto max-w-lg shadow"
        />
      )}

      {/* 訪問予定リスト作成モード: 右側パネル(選択済みスポットの並び替え・削除・入力完了) */}
      {buildDraft && (
        <PlanBuildPanel
          title={buildDraft.title}
          editing={buildDraft.editingId !== null}
          spotIds={buildDraft.spotIds}
          spotsById={buildPanelSpotById}
          seriesStyles={seriesStyles}
          rankEnabled={rankEnabled}
          saving={savingList}
          focusedSpotId={focusedBuildSpotId}
          onFocusSpot={focusBuildSpot}
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
          名前だけでは入れるか決められないため、スポットの説明とGoogleの導線
          (地図・経路・画像検索・Gemini)も出す。スポット詳細と同じ並び */}
      {addCandidate && buildDraft && (
        <Modal
          onClose={closeAddCandidate}
          zIndexClassName="z-[60]"
          panelClassName="max-h-[85dvh] w-full max-w-sm space-y-3 overflow-y-auto rounded-2xl bg-white p-4"
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
                    <LinkedText text={spot.description} />
                  </p>
                )}
                {/* スポット詳細と同じ体裁: 上に区切り線を引いて右へ寄せる */}
                {spot && (
                  <div className="flex border-t border-gray-100 pt-3">
                    <GoogleSpotLinks
                      spot={spot}
                      spotType={addCandidateSpotType}
                      className="ml-auto"
                    />
                  </div>
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
        </Modal>
      )}

      {/* 右クリック/長押しメニュー */}
      {contextMenu && (
        <>
          {/* メニューの外を押したら閉じる当たり判定(キーボードからはEscや別の操作で抜ける) */}
          <button
            type="button"
            tabIndex={-1}
            aria-label="メニューを閉じる"
            className="fixed inset-0 z-30 cursor-default"
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
              type="button"
              onClick={() => {
                setAddSpotAt({ lat: contextMenu.lat, lng: contextMenu.lng });
                setContextMenu(null);
              }}
              className="block w-full whitespace-nowrap px-4 py-2 text-left text-sm hover:bg-gray-50"
            >
              ここにスポットを追加
            </button>
            {role && SPOT_ADMIN_ROLES.includes(role) && (
              <button
                type="button"
                onClick={() => {
                  setAddRequestAt({ lat: contextMenu.lat, lng: contextMenu.lng });
                  setAddRequestReason("");
                  setAddRequestError(null);
                  setContextMenu(null);
                }}
                className="block w-full whitespace-nowrap px-4 py-2 text-left text-sm hover:bg-gray-50"
              >
                ここにスポット追加を依頼
              </button>
            )}
          </div>
        </>
      )}

      {/* 追加の依頼。理由は空でもよい(修正の依頼と同じく、気づいた時点で印だけ付けられる) */}
      {addRequestAt && (
        <Modal
          onClose={() => !addRequestSaving && setAddRequestAt(null)}
          panelClassName="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl"
        >
          <h2 className="mb-1 font-bold">ここにスポット追加を依頼</h2>
          <p className="mb-2 text-xs text-gray-500">
            {addRequestAt.lat.toFixed(5)}, {addRequestAt.lng.toFixed(5)}
            。管理画面の「修正・追加の依頼」に残ります(スポットは作られません)。
          </p>
          <label htmlFor={`${fid}-add-request-reason`} className="mb-1 block text-xs font-bold text-gray-700">
            何が足りないか(空でもよい)
          </label>
          <textarea
            id={`${fid}-add-request-reason`}
            value={addRequestReason}
            onChange={(e) => setAddRequestReason(e.target.value)}
            rows={3}
            placeholder="例: 「○○」という店がこの辺りにある"
            className="w-full rounded-lg border border-gray-300 p-2 text-sm"
          />
          {addRequestError && (
            <p className="mt-1 text-xs text-red-600">{addRequestError}</p>
          )}
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setAddRequestAt(null)}
              disabled={addRequestSaving}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm"
            >
              やめる
            </button>
            <button
              type="button"
              disabled={addRequestSaving}
              onClick={async () => {
                setAddRequestSaving(true);
                setAddRequestError(null);
                const { error } = await api.spotFlags.requestAdd(
                  spotTypeKey,
                  addRequestAt.lat,
                  addRequestAt.lng,
                  addRequestReason
                );
                setAddRequestSaving(false);
                if (error) {
                  setAddRequestError("依頼を送れませんでした: " + error.message);
                  return;
                }
                setAddRequestAt(null);
                loadMyRequests();
                setAddRequestNotice("スポット追加を依頼しました");
                window.setTimeout(() => setAddRequestNotice(null), 3000);
              }}
              className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {addRequestSaving ? "依頼しています…" : "依頼する"}
            </button>
          </div>
        </Modal>
      )}
      {addRequestNotice && (
        <div className="pointer-events-none fixed bottom-20 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-gray-800 px-3 py-2 text-sm text-white shadow-lg">
          {addRequestNotice}
        </div>
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
        <Modal
          onClose={closeRouteDetail}
          panelClassName="max-h-[85dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-4"
          panelRef={detailPanelRef}
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
              <LinkedText text={routeDetailView.description} />
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
                      {/* そのスポットの、予定の日の天気。**リスト詳細と同じものを
                          ここにも出す** —— 旅程を見る場所が2つあり、片方だけに
                          天気があると地図から見たときだけ調べ直すことになる */}
                      {point.weatherSpot && routeDetailView.weatherDate && (
                        <WeatherAskLink
                          spot={point.weatherSpot}
                          date={routeDetailView.weatherDate}
                          weather={weatherBySpot.get(point.weatherSpot.id)}
                          className="-my-1"
                        />
                      )}
                    </div>
                    {/* 区間の説明は次の地点との間に表示(最終地点には次の区間が無い) */}
                    {i < routeDetailView.points.length - 1 && (
                      <div className="flex items-baseline gap-2 py-0.5 text-xs text-gray-500">
                        {/* 並び替えハンドルのぶんの空き(番号の列を上下でそろえる) */}
                        {reorderList && <span className="w-5 shrink-0" />}
                        <span className="w-6 shrink-0 text-right">↓</span>
                        {point.legDescription && (
                          <span className="min-w-0 whitespace-pre-wrap">
                            <LinkedText text={point.legDescription} />
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
        </Modal>
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
          onClose={() => {
            setOverlayDetailSpotId(null);
            // 一覧から開いていたら戻す
            if (stackReturn) {
              setStack(stackReturn);
              setStackReturn(null);
            }
          }}
          onVisitChange={loadVisits}
          // 重ね表示スポットを現在の種別のリストへ追加したら、経路表示中のリストの
          // 線にも反映されるようリスト一覧を取り直す
          onPlanListChange={loadPlanLists}
        />
      )}

      {/* スポット詳細モーダル */}
      {/* 同じ座標にスポットが重なっているときの選択一覧。ピンは完全に重なって
          しまい下のスポットを開く手段が無くなるため、タップでここに列挙する
          (ピン側には重なり数のバッジを出して重なりの存在を知らせている) */}
      {stack &&
        (() => {
          // 重ね表示のピンから開いたときは、名前もランク・カテゴリの表記も
          // **そのスポットが属する種別**の設定で解決する(本体の設定で描くと
          // 名前が出ない・ランクのラベルがずれる)
          const overlayTypeKey = stack.overlayTypeKey;
          const stackSpotById = overlayTypeKey ? overlaySpotById : spotById;
          const stackRankEnabled = overlayTypeKey
            ? overlayRankEnabledOf(overlayTypeKey)
            : rankEnabled;
          const stackCategories = overlayTypeKey
            ? overlayCategoriesOf(overlayTypeKey)
            : categories;
          const stackSeriesStyles = overlayTypeKey
            ? overlaySeriesStylesOf(overlayTypeKey)
            : seriesStyles;
          return (
            <Modal
              onClose={() => {
                setStack(null);
                setStackReturn(null);
              }}
              containerClassName="items-end sm:items-center"
              panelClassName="flex max-h-[85vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
            >
            {/* 横幅は一覧に必要な分だけ。件数が多いと縦に伸びるので、画面の高さいっぱいまで
                使い、はみ出す分だけ一覧側をスクロールさせる */}
              <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold">
                    この地点のスポット({stack.ids.length}件)
                  </h2>
                  {/* 簡単な住所。同じ地点に積まれているので1つだけ出す
                      (引けなかったときは行ごと出さない) */}
                  {stackAddress && (
                    <p className="truncate text-xs text-slate-500">{stackAddress}</p>
                  )}
                </div>
                <button
                  type="button"
                  className="shrink-0 text-slate-400 hover:text-slate-600"
                  aria-label="閉じる"
                  onClick={() => {
                    setStack(null);
                    setStackReturn(null);
                  }}
                >
                  ✕
                </button>
              </div>
              <ul className="min-h-0 flex-1 divide-y overflow-y-auto">
                {stack.ids.map((id) => {
                  const spot = stackSpotById.get(id);
                  if (!spot) return null;
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-slate-50"
                        onClick={() => {
                          // 詳細を閉じたらこの一覧へ戻す(地図からは開き直せない)
                          setStackReturn(stack);
                          setStack(null);
                          if (overlayTypeKey) openOverlaySpot(id);
                          else handleSpotSelect(id);
                        }}
                      >
                        {/* 一覧・詳細と同じスポットの印。ランクは色と大きさで出る ——
                            同じ地点に積まれたピンは地図側で区別が付かないので、
                            ここで並べたときにどれが目立つスポットかを読めるようにする */}
                        <SpotBadge
                          rank={spot.rank}
                          series={spot.series}
                          seriesStyles={stackSeriesStyles}
                          rankEnabled={stackRankEnabled}
                          isPrivate={spot.status === "private"}
                          size="sm"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{spot.name}</span>
                          {/* 一覧・詳細と同じ1行(同じ地点なので地域は出さない) */}
                          <span className="block truncate text-xs text-slate-500">
                            {formatSpotMeta(spot, {
                              rankEnabled: stackRankEnabled,
                              categories: stackCategories,
                              includeRegion: false,
                            })}
                          </span>
                        </span>
                        {visitedIds.has(id) && (
                          <span className="shrink-0 text-xs text-green-600">
                            ✓訪問済み
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Modal>
          );
        })()}

      {detailSpotId && (
        <SpotDetailModal
          spotId={detailSpotId}
          spots={spots}
          onClose={() => {
            setDetailSpotId(null);
            // 一覧から開いていたら戻す
            if (stackReturn) {
              setStack(stackReturn);
              setStackReturn(null);
            }
          }}
          onVisitChange={loadVisits}
          // 既存の訪問予定リストへの追加をリスト一覧へ反映する(経路表示中の
          // リストに追加した場合、地図の紫の経路も引き直される)
          onPlanListChange={loadPlanLists}
          // 非表示にする/解除をピンの表示へ即反映する
          onHideChange={loadHides}
          // 修正の依頼の輪を即反映する
          onFlagChange={loadMyRequests}
          // 位置を直した・消したスポットに修正の依頼があれば、輪も動かす・消す
          onSpotChange={(spot) => {
            spotCache.applySpotChange(spot);
            loadPrivateSpots();
            loadMyRequests();
          }}
          onSpotDeleted={(id) => {
            spotCache.applySpotDelete(id);
            loadPrivateSpots();
            loadMyRequests();
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
