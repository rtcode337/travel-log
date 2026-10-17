"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { type Visit, visitPlace } from "@/lib/types";
import { distanceMeters, formatDistance, type LatLng } from "@/lib/coords";
import { toDateTimeLocalValue } from "@/lib/visitPhoto";
import VisitFields from "@/components/VisitFields";
import HelpTip from "@/components/HelpTip";
import Modal from "@/components/Modal";
import PickLocationModal from "@/components/PickLocationModal";

export default function VisitFormModal({
  spotId,
  spotName,
  spotPosition,
  reviewsEnabled,
  visit,
  onClose,
  onSaved,
}: {
  spotId: string;
  spotName: string;
  /** スポットのピンの位置(「行った場所」を指す地図をここから開く・距離を出す) */
  spotPosition: LatLng;
  /** falseならこのスポット種別では口コミ機能が無効なので入力欄自体を出さない */
  reviewsEnabled: boolean;
  /** 指定すると既存の訪問記録の編集モードになる(口コミ入力欄は出さない) */
  visit?: Visit;
  onClose: () => void;
  /** 保存後に、保存された訪問記録とともに呼ばれる(呼び出し元が未訪問記録かどうか・
   *  日時の有無で後続処理(訪問予定リストからの自動除外など)を出し分けるのに使う) */
  onSaved: (saved?: Visit) => void;
}) {
  // datetime-localは「ローカル時刻のYYYY-MM-DDTHH:mm」を扱うため、現在時刻を
  // UTCではなくローカルのまま初期値にする(toISOStringだとUTCにずれる)。
  // 編集時は既存の訪問日時(未入力=時期不明なら空欄)から始める
  const [visitedOn, setVisitedOn] = useState(() =>
    visit
      ? visit.visited_on
        ? toDateTimeLocalValue(new Date(visit.visited_on))
        : ""
      : toDateTimeLocalValue(new Date())
  );
  const [memo, setMemo] = useState(visit?.memo ?? "");
  // 未訪問記録(訪問済みに数えない記録)にするか。編集時は既存値から始める
  const [unvisited, setUnvisited] = useState(visit?.unvisited ?? false);
  // 各要素は「既存写真の相対パス」または「追加写真のdata URL」。この形のまま
  // PATCHに渡す(サーバー側がパス=残す・data URL=新規保存と解釈する)
  const [photos, setPhotos] = useState<string[]>(visit?.photos ?? []);
  const [processingPhotos, setProcessingPhotos] = useState(false);
  // 「行った場所」(nullならスポットの位置)。編集時は既存値から始める
  const [place, setPlace] = useState<LatLng | null>(() =>
    visit ? visitPlace(visit) : null
  );
  // 行った場所を指す地図を開いているとき、その開始位置
  const [pickingFrom, setPickingFrom] = useState<LatLng | null>(null);
  // 添えた写真のうち、撮影地の読めた最初の1枚の位置(行った場所をそこで指せるように)
  const [photoGps, setPhotoGps] = useState<LatLng | null>(null);
  const [reviewBody, setReviewBody] = useState("");
  // 口コミの入力欄を開いているか(既定は畳む)
  const [showReview, setShowReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    // ローカル時刻の入力値をISO 8601(UTC)にしてから送る。文字列のまま送ると
    // DB(timestamptz)がサーバーのタイムゾーンで解釈してずれる
    const payload = {
      spot_id: spotId,
      visited_on: visitedOn ? new Date(visitedOn).toISOString() : null,
      memo: memo.trim() || null,
      photos,
      unvisited,
      // 指していなければnull(=スポットの位置)。編集で「スポットの位置に戻す」もnullで送る
      place_lat: place?.lat ?? null,
      place_lng: place?.lng ?? null,
    };
    const { data: saved, error: visitError } = visit
      ? await api.visits.update(visit.id, payload)
      : await api.visits.create(payload);
    if (visitError) {
      setSaving(false);
      setError("保存に失敗しました: " + visitError.message);
      return;
    }

    if (!visit && reviewsEnabled && !unvisited && reviewBody.trim()) {
      const { error: reviewError } = await api.reviews.create(
        spotId,
        reviewBody.trim()
      );
      if (reviewError) {
        setSaving(false);
        setError("訪問は記録しましたが、口コミの保存に失敗しました: " + reviewError.message);
        return;
      }
    }

    setSaving(false);
    onSaved(saved ?? undefined);
  };

  return (
    <>
    <Modal
      onClose={onClose}
      closeOnBackdrop={false}
      panelClassName="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4"
    >
      <h2 className="mb-1 font-bold">
        {visit
          ? unvisited
            ? "未訪問記録を編集"
            : "訪問記録を編集"
          : unvisited
            ? "未訪問記録を追加"
            : "訪問を記録"}
      </h2>
      <p className="mb-4 text-sm text-gray-500">{spotName}</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <VisitFields
          visitedOn={visitedOn}
          onVisitedOnChange={setVisitedOn}
          memo={memo}
          onMemoChange={setMemo}
          photos={photos}
          onPhotosChange={setPhotos}
          onProcessingChange={setProcessingPhotos}
          onFirstPhotoGpsChange={setPhotoGps}
          visitedOnHint={
            unvisited
              ? "「削除」で空にすると下調べのメモになります(どの経路にも含まれず、訪問予定も残ります)。"
              : undefined
          }
        />

        {/* 行った場所。ピンが店そのものではない種別(ご当地グルメのピンは発祥地や
            主要駅にある)で、実際に行った位置を残すためのもの。全種別で使える。
            地図は別のモーダルで開く —— フォームに地図を埋めると、保存ボタンが
            画面の外へ押し出される */}
        <div className="border-t border-gray-100 pt-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="text-sm font-medium">行った場所</p>
            <HelpTip>
              スポットのピンとは別の、実際に行った位置を残せます(ご当地グルメのように、
              ピンが発祥地や駅に置かれていて、食べた店はそこに無いときなど)。
              指した位置は、その日の訪問順の経路と訪問記録の書き出しで使われます。
              指さなければスポットの位置として扱います。
            </HelpTip>
            <span className={`text-xs ${place ? "text-gray-800" : "text-gray-500"}`}>
              {place
                ? `指した位置(スポットから${formatDistance(distanceMeters(spotPosition, place))})`
                : "スポットの位置"}
            </span>
          </div>
          {/* 保存ボタンを画面の外へ押し出さないよう、操作は1行に収める
              (戻すは文字のリンクにして幅を取らない) */}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPickingFrom(place ?? spotPosition)}
              className="rounded-lg border border-gray-300 px-2.5 py-1 text-xs text-gray-700"
            >
              {place ? "地図で直す" : "地図で指す"}
            </button>
            {/* 添えた写真に撮影地が入っていれば、そこから指し始められる
                (そのまま決めずに地図で確かめてもらう。写真の位置は数十mずれることがある) */}
            {photoGps && (
              <button
                type="button"
                onClick={() => setPickingFrom(photoGps)}
                className="rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs text-blue-700"
              >
                添えた写真の位置で指す
              </button>
            )}
            {place && (
              <button
                type="button"
                onClick={() => setPlace(null)}
                className="px-1 py-1 text-xs text-gray-500 underline"
              >
                スポットの位置に戻す
              </button>
            )}
          </div>
        </div>

        {/* 未訪問記録の切り替え。訪問記録と同じフォーム・同じ訪問履歴に記録し、
            訪問済みに数えるかどうかだけをこのフラグで分ける。
            説明はHelpTipに畳む(常に出していると保存ボタンが画面外へ押し出される)。
            HelpTipのボタンはlabelの外に置く —— 中に入れると押したときに
            チェックボックスまで切り替わってしまう */}
        <div className="border-t border-gray-100 pt-3">
          <div className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-2 font-medium">
              <input
                type="checkbox"
                checked={unvisited}
                onChange={(e) => setUnvisited(e.target.checked)}
              />
              未訪問記録にする(訪問済みにしない)
            </label>
            <HelpTip>
              休みや時間の都合でちゃんと見られなかったときや、事前の下調べのメモに。
              訪問日時を入れると「訪れたが改めて来たい」記録としてその日の経路に含まれ、
              訪問予定からも外れます。訪問日時が空欄なら下調べのメモになり、
              どの経路にも含まれず、訪問予定も残ります。
            </HelpTip>
          </div>
        </div>

        {/* 口コミは訪問記録とは独立のデータのため、編集モードと未訪問記録では出さない。
            書かないことのほうが多いため既定では畳んでおく(入力欄を開いたままだと
            保存ボタンが画面外へ押し出される)。**畳んでも入力済みの本文は投稿する**
            ため、畳んだ状態でも入力があることが分かるようにしてある */}
        {reviewsEnabled && !visit && !unvisited && (
          <div className="border-t border-gray-100 pt-3">
            <button
              type="button"
              onClick={() => setShowReview((v) => !v)}
              aria-expanded={showReview}
              className="flex w-full items-center gap-1 text-sm font-medium text-blue-600"
            >
              <span aria-hidden="true" className="text-xs">
                {showReview ? "▾" : "▸"}
              </span>
              口コミを投稿する(公開・任意)
              {!showReview && reviewBody.trim() && (
                <span className="text-xs font-normal text-gray-400">
                  入力済み
                </span>
              )}
            </button>
            {showReview && (
              <>
                <p className="mb-2 mt-2 text-xs text-gray-400">
                  他のユーザーにも公開されます。投稿するたびに新しい口コミとして
                  追加されます(上書きはされません)。
                </p>
                <textarea
                  value={reviewBody}
                  onChange={(e) => setReviewBody(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  placeholder="行ってみた感想など"
                />
              </>
            )}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-gray-300 py-2 text-sm"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={saving || processingPhotos}
            className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </form>
    </Modal>
    {pickingFrom && (
      <PickLocationModal
        title="行った場所を指す"
        description={
          <>
            {spotName}の訪問で、実際に行った位置に赤いピンを合わせてください。
            近くのスポットの点に近づけると、その位置に重なります。
          </>
        }
        initial={pickingFrom}
        confirmLabel="この位置にする"
        onConfirm={(pos) => {
          setPlace(pos);
          setPickingFrom(null);
        }}
        onClose={() => setPickingFrom(null)}
      />
    )}
    </>
  );
}
