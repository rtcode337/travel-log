"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import {
  ALLOWED_STATUS_BY_ROLE,
  PREFECTURES,
  STATUS_LABELS,
  distinctValues,
  type Series,
  type Category,
  type Role,
  type Spot,
  type SpotStatus,
} from "@/lib/types";
import { DEFAULT_REGION_SCOPE, regionFieldLabel } from "@/lib/region";
import { useRegionScope } from "@/lib/useRegionScope";
import { useCategories } from "@/lib/useCategories";
import { useSeriesStyles } from "@/lib/useSeriesStyles";
import { useRankEnabled } from "@/lib/useRankEnabled";
import { RANKS, type Rank } from "@/lib/rank";
import { UNSET_SERIES } from "@/lib/seriesStyle";
import { useCurrentSpotTypeKey } from "@/lib/useSpotTypeKey";
import { toDateTimeLocalValue } from "@/lib/visitPhoto";
import VisitFields from "@/components/VisitFields";

export default function AddSpotModal({
  lat,
  lng,
  spotTypeKey,
  spot,
  spots,
  role,
  onClose,
  onSaved,
  onDeleted,
}: {
  /** 新規作成時の座標(spotが指定された編集モードでは使わない) */
  lat?: number;
  lng?: number;
  /** 新規作成先のスポット種別キー(新規作成時のみ必須。編集モードでは種別を変えないので不要) */
  spotTypeKey?: string;
  /** 指定すると編集モードになり、フォームに既存の値を読み込む。非公開スポットの
   * 作成者本人のみがこのモードで開ける想定(呼び出し元で権限チェック済み) */
  spot?: Spot;
  /** シリーズ・カテゴリ入力のサジェスト用に、現在アクティブな種別の既存スポットを渡す */
  spots: Spot[];
  /** 選べるstatusの選択肢を決める(新規作成時のみ使用。nullなら非公開のみ扱う) */
  role: Role | null;
  onClose: () => void;
  /** `visitRecorded`は「訪問を記録」を開いたまま送信し、訪問記録も1件付けたとき。
   *  呼び出し側が訪問済みの表示・訪問順の経路を取り直すのに使う */
  onSaved: (spot: Spot, visitRecorded: boolean) => void;
  onDeleted?: () => void;
}) {
  const isEdit = !!spot;
  // 編集モード(SpotDetailModal経由)はspotTypeKeyが渡らないため、URLの[type]で補う
  const currentTypeKey = useCurrentSpotTypeKey();
  const typeKey = spotTypeKey ?? currentTypeKey ?? "";
  // 種別の対象地域スコープ。'jp'なら地域欄は都道府県セレクト、それ以外は自由入力
  const regionScope = useRegionScope(typeKey);
  const scope = regionScope ?? DEFAULT_REGION_SCOPE;
  const allowedStatuses: SpotStatus[] = role
    ? ALLOWED_STATUS_BY_ROLE[role]
    : ["private"];
  // 新規作成時の初期選択は権限に関わらず常に非公開(モデレーター/管理者も含めて)
  const defaultStatus: SpotStatus = "private";

  const [name, setName] = useState(spot?.name ?? "");
  const [nameKana, setNameKana] = useState(spot?.name_kana ?? "");
  const [spotLat, setSpotLat] = useState(String(spot?.lat ?? lat ?? ""));
  const [spotLng, setSpotLng] = useState(String(spot?.lng ?? lng ?? ""));
  const [region, setRegion] = useState(spot?.region ?? "");
  const [rank, setRank] = useState<Rank | "">(spot?.rank ?? "");
  const [series, setSeries] = useState<Series>(spot?.series ?? "");
  const [categories, setCategories] = useState<Category[]>(spot?.categories ?? []);
  // 一覧に無いカテゴリを手入力で足すための欄(確定するとcategoriesに入る)
  const [categoryInput, setCategoryInput] = useState("");
  const [description, setDescription] = useState(spot?.description ?? "");
  const [status, setStatus] = useState<SpotStatus>(defaultStatus);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  // 追加と同時に付ける訪問記録。既定は畳んであり、**開いたまま送信したときだけ**
  // 記録する(開く操作自体が「ここへ行った」の意思表示。畳んだまま送れば
  // 入力欄に既定値が入っていても記録は付かない)
  const [recordVisit, setRecordVisit] = useState(false);
  const [visitedOn, setVisitedOn] = useState(() =>
    toDateTimeLocalValue(new Date())
  );
  const [visitMemo, setVisitMemo] = useState("");
  const [visitPhotos, setVisitPhotos] = useState<string[]>([]);
  const [processingPhotos, setProcessingPhotos] = useState(false);

  // 実際に適用されるstatus(編集は既存のまま、新規は選択中のstatus)。
  // 非公開スポット以外はシリーズ必須(非公開はシリーズ未設定のままにできる)
  const effectiveStatus: SpotStatus = isEdit ? spot!.status : status;
  const seriesRequired = effectiveStatus !== "private";

  // シリーズはこの種別のJSON設定(series_styles)から選ぶ(自由入力を廃止)。
  // 編集中スポットの既存シリーズが設定一覧に無い場合は、選択を保てるよう末尾に足す
  const seriesStyles = useSeriesStyles(typeKey);
  // ランクを使わない種別では欄ごと出さない(常に「なし」)
  const rankEnabled = useRankEnabled(typeKey);
  const seriesOptions = useMemo(() => {
    const configured = seriesStyles.map((s) => s.series);
    return series && !configured.includes(series)
      ? [...configured, series]
      : configured;
  }, [seriesStyles, series]);

  // 新規追加時のみ、置いた座標から地域(都道府県/州・県/国)を自動入力する
  // (手で上書き可能)。地域の解決方法がスコープに依存するため、スコープの取得完了を待つ
  useEffect(() => {
    if (isEdit || lat == null || lng == null || regionScope === null) return;
    setLocating(true);
    api.geocode.reverse(lat, lng, regionScope).then(({ data }) => {
      setLocating(false);
      if (!data) return;
      const resolved = data.region;
      // 'jp'では既知の都道府県名のみ採用(セレクトボックスに無い値を入れない)
      if (
        resolved &&
        (regionScope !== "jp" ||
          PREFECTURES.includes(resolved as (typeof PREFECTURES)[number]))
      ) {
        setRegion((prev) => prev || resolved);
      }
    });
  }, [isEdit, lat, lng, regionScope]);

  // 'jp'以外のスコープでは地域は自由入力のため、既存スポットの地域をサジェストする
  const availableRegions = useMemo(
    () => distinctValues(spots.map((s) => s.region)),
    [spots]
  );
  // カテゴリのサジェストは種別のカテゴリ設定(並び順どおり)を先頭に、
  // 設定に無い既存スポットの値(過去データ等)を後ろに足して出す
  const definedCategories = useCategories(typeKey);
  const availableCategories = useMemo(() => {
    const existing = distinctValues(spots.flatMap((s) => s.categories));
    const merged = [
      ...definedCategories,
      ...existing.filter((c) => !definedCategories.includes(c)),
    ];
    // 手入力で足した直後の値も選択チップとして出す(まだどのスポットにも無いため)
    return [...merged, ...categories.filter((c) => !merged.includes(c))];
  }, [spots, definedCategories, categories]);

  const toggleCategory = (category: Category) => {
    setCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category]
    );
  };

  const addCategoryFromInput = () => {
    const value = categoryInput.trim();
    if (!value) return;
    setCategories((prev) => (prev.includes(value) ? prev : [...prev, value]));
    setCategoryInput("");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 非公開スポット以外はシリーズ必須(非公開はシリーズ未設定のままにできる)
    if (seriesRequired && !series.trim()) {
      setError("公開・承認待ちのスポットはシリーズを選択してください。");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      name: name.trim(),
      name_kana: nameKana.trim() || null,
      lat: Number(spotLat),
      lng: Number(spotLng),
      region: region.trim(),
      rank: rank || null,
      series: series.trim() || null,
      categories,
      description: description.trim() || null,
    };
    const { data, error } = isEdit
      ? await api.spots.update(spot!.id, payload)
      : await api.spots.create({ ...payload, status }, spotTypeKey!);
    if (error || !data) {
      setSaving(false);
      setError("送信に失敗しました: " + (error?.message ?? "unknown error"));
      return;
    }
    // 「訪問を記録」を開いていたときは、作成したスポットに訪問記録を1件つける(口コミは無し)
    const withVisit = recordVisit && !isEdit;
    if (withVisit) {
      const { error: visitError } = await api.visits.create({
        spot_id: data.id,
        visited_on: visitedOn ? new Date(visitedOn).toISOString() : null,
        memo: visitMemo.trim() || null,
        photos: visitPhotos,
      });
      if (visitError) {
        setSaving(false);
        setError(
          "スポットは追加しましたが、訪問の記録に失敗しました: " +
            visitError.message
        );
        return;
      }
    }
    setSaving(false);
    onSaved(data, withVisit);
  };

  const handleDelete = async () => {
    if (!spot) return;
    if (!confirm(`「${spot.name}」を削除しますか?`)) return;
    setDeleting(true);
    setError(null);
    const { error } = await api.spots.delete(spot.id);
    setDeleting(false);
    if (error) {
      setError("削除に失敗しました: " + error.message);
      return;
    }
    onDeleted?.();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-4"
      >
        <h2 className="font-bold">
          {isEdit ? "スポットを編集" : "この場所にスポットを追加"}
        </h2>
        {!isEdit && lat != null && lng != null && (
          <p className="text-xs text-gray-500">
            緯度 {lat.toFixed(5)} ・ 経度 {lng.toFixed(5)}
          </p>
        )}
        {isEdit ? (
          <p className="rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
            {spot?.status === "private" &&
              "非公開スポットです。自分にだけ表示されます。"}
            {spot?.status === "pending" &&
              "承認待ちスポットです。承認されると本人でも編集できなくなります。"}
            {spot?.status === "rejected" && "却下されたスポットです。"}
            {spot?.status === "published" &&
              "公開中のスポットです。編集内容はすぐに全員の地図に反映されます。"}
          </p>
        ) : allowedStatuses.length > 1 ? (
          <div>
            <label className="mb-1 block text-sm font-medium">状態</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as SpotStatus)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            >
              {allowedStatuses.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              {status === "private" &&
                "非公開: 自分にだけ表示されます。口コミは使えません。"}
              {status === "pending" &&
                "承認待ち: スポット管理者・管理者が承認すると地図に公開されます。"}
              {status === "published" && "公開: すぐに全員の地図に表示されます。"}
            </p>
          </div>
        ) : (
          <p className="rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
            非公開スポットとして追加されます。自分にだけ表示され、口コミは使えません。
          </p>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium">名前 *</label>
          <input
            required
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        {/* 追加と同時に訪問を記録する欄。「探訪スポットを追加」だった頃と同じく
            名前とよみがなの間・同じ体裁(青の見出しと薄青の面)で置き、
            **既定は畳んでおく**(ふだんの追加では使わないため)。
            かつては長押しメニューの別の入口だったが、同じフォームの折り畳みにして
            入口を1つにした */}
        {!isEdit && (
          <div className="rounded-lg border border-blue-100 bg-blue-50/40">
            <button
              type="button"
              onClick={() => setRecordVisit((prev) => !prev)}
              aria-expanded={recordVisit}
              className="flex w-full items-center justify-between gap-2 p-3 text-left text-sm font-medium text-blue-800"
            >
              <span>
                訪問を記録
                <span className="ml-1 text-xs font-normal text-blue-700/70">
                  (任意)
                </span>
              </span>
              <span className="text-xs text-blue-700/70">
                {recordVisit ? "▲" : "▼"}
              </span>
            </button>
            {recordVisit && (
              <div className="space-y-3 border-t border-blue-100 p-3">
                <p className="text-xs text-gray-500">
                  開いたまま送信すると、追加したスポットに訪問記録が1件つきます(口コミは無し)。畳むと記録しません。
                </p>
                <VisitFields
                  visitedOn={visitedOn}
                  onVisitedOnChange={setVisitedOn}
                  memo={visitMemo}
                  onMemoChange={setVisitMemo}
                  photos={visitPhotos}
                  onPhotosChange={setVisitPhotos}
                  onProcessingChange={setProcessingPhotos}
                />
              </div>
            )}
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium">よみがな</label>
          <input
            autoComplete="off"
            value={nameKana}
            onChange={(e) => setNameKana(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        {(isEdit || lat == null) && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-sm font-medium">緯度 *</label>
              <input
                required
                type="number"
                step="any"
                value={spotLat}
                onChange={(e) => setSpotLat(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">経度 *</label>
              <input
                required
                type="number"
                step="any"
                value={spotLng}
                onChange={(e) => setSpotLng(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
              />
            </div>
          </div>
        )}
        {locating && (
          <p className="text-xs text-gray-400">座標から住所を自動取得中…</p>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium">
            {regionFieldLabel(scope)} *
          </label>
          {scope === "jp" ? (
            <select
              required
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            >
              <option value="">選択</option>
              {PREFECTURES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          ) : (
            <>
              <input
                required
                autoComplete="off"
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                list="add-spot-region-suggestions"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <datalist id="add-spot-region-suggestions">
                {availableRegions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </>
          )}
        </div>
        {/* ランクはピンの色と大きさを決める段階(A〜E)。使う種別でだけ出す */}
        {rankEnabled && (
          <div>
            <label className="mb-1 block text-sm font-medium">ランク</label>
            <select
              value={rank}
              onChange={(e) => setRank(e.target.value as Rank | "")}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            >
              <option value="">なし</option>
              {RANKS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-gray-500">
              地図のピンの色と大きさを決めます(Aが最も大きく目立ちます)。なしは白で、Bと同じ大きさになります。
            </p>
          </div>
        )}
        <div>
          <label className="mb-1 block text-sm font-medium">
            シリーズ {seriesRequired && "*"}
          </label>
          <select
            required={seriesRequired}
            value={series}
            onChange={(e) => setSeries(e.target.value as Series)}
            className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
          >
            {/* 非公開はシリーズ未設定のままにできる。公開・承認待ちは必須 */}
            <option value="">
              {seriesRequired ? "選択してください" : UNSET_SERIES}
            </option>
            {seriesOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {!seriesRequired && (
            <p className="mt-1 text-xs text-gray-500">
              非公開スポットではシリーズを選ばなくてもかまいません(ピンの中身が空になります)。
            </p>
          )}
        </div>
        {/* カテゴリは1スポットに複数付けられるため、選択チップ(トグル)で選ぶ。
            一覧に無いものは下の入力欄から足す(足した値もチップとして並ぶ) */}
        <div>
          <label className="mb-1 block text-sm font-medium">
            カテゴリ
            <span className="ml-1 text-xs font-normal text-gray-500">
              (複数選択可)
            </span>
          </label>
          {availableCategories.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {availableCategories.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => toggleCategory(c)}
                  className={`rounded-full border px-3 py-1 text-sm font-medium ${
                    categories.includes(c)
                      ? "border-transparent bg-blue-600 text-white"
                      : "border-gray-300 bg-white text-gray-500"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={categoryInput}
              onChange={(e) => setCategoryInput(e.target.value)}
              onKeyDown={(e) => {
                // フォーム全体の送信ではなく、カテゴリの追加として扱う
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCategoryFromInput();
                }
              }}
              placeholder="一覧に無いカテゴリを追加"
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            />
            <button
              type="button"
              onClick={addCategoryFromInput}
              disabled={!categoryInput.trim()}
              className="shrink-0 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium disabled:opacity-40"
            >
              追加
            </button>
          </div>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">説明</label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={saving || deleting || processingPhotos}
            className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving
              ? "送信中…"
              : isEdit
                ? "保存"
                : `${STATUS_LABELS[status]}で送信`}
          </button>
        </div>
        {isEdit && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={saving || deleting}
            className="w-full rounded-lg border border-red-300 py-2 text-sm text-red-600 disabled:opacity-50"
          >
            {deleting ? "削除中…" : "このスポットを削除"}
          </button>
        )}
      </form>
    </div>
  );
}
