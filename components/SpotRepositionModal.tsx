"use client";

import { api } from "@/lib/api-client";
import type { Spot } from "@/lib/types";
import PickLocationModal from "@/components/PickLocationModal";

/**
 * スポットの位置(緯度経度)を、ドラッグできるマーカーで指すモーダル。2 つの使い方がある。
 * 地図そのもの(拡大率・現在地の青丸・近くのスポットへの吸着・写真の位置)は
 * `PinPickerMap`の共通部品で、ここは保存のしかただけを受け持つ。
 *
 * - **非公開スポットの位置を直す**(`onSaved`)。スポット詳細の「位置を修正」から開き、
 *   保存でPATCHする(座標以外は既存の値をそのまま送って消えないようにする)
 * - **公開スポットの位置を報告する**(`onPick`)。スポット詳細の「位置を報告」から
 *   開き、スポットそのものには触らずに、指した座標を呼び出し側へ渡す(依頼にする)。
 *   公開スポットは収集から取り込み直されるので、ここで直しても次の取り込みで戻る ——
 *   直すのは収集を回す側で、こちらは正しい位置を伝えるだけ
 */
export default function SpotRepositionModal({
  spot,
  onClose,
  onSaved,
  onPick,
}: {
  spot: Spot;
  onClose: () => void;
  onSaved?: (updated: Spot) => void;
  /** 指した座標を渡す。失敗したら理由を返す(モーダルに出す) */
  onPick?: (lat: number, lng: number) => Promise<string | null>;
}) {
  const handleConfirm = async ({ lat, lng }: { lat: number; lng: number }) => {
    if (onPick) return onPick(lat, lng);
    // 座標以外は既存値をそのまま送る(PATCHはこれらを無条件に上書きするため、
    // 送らないとnullで消えてしまう。categories/key/originは省略時は保持される)
    const { data, error } = await api.spots.update(spot.id, {
      name: spot.name,
      name_kana: spot.name_kana,
      lat,
      lng,
      region: spot.region,
      rank: spot.rank,
      series: spot.series,
      description: spot.description,
    });
    if (error || !data) {
      return "保存に失敗しました: " + (error?.message ?? "unknown error");
    }
    onSaved?.(data);
    return null;
  };

  return (
    <PickLocationModal
      title={onPick ? "位置を報告" : "位置を修正"}
      description={
        <>
          赤いピンをドラッグして正しい位置に合わせてください。
          同じ建物に入っているスポットがあれば、その点に近づけると同じ位置に重なります。
          {onPick &&
            "いまの位置で合っていれば、動かさずにそのまま報告してください。スポットはすぐには動きません(収集を回す側が直したあと、取り込み直すと反映されます)。"}
        </>
      }
      initial={{ lat: spot.lat, lng: spot.lng }}
      excludeSpotId={spot.id}
      confirmLabel={onPick ? "この位置で報告" : "この位置で保存"}
      savingLabel={onPick ? "依頼しています…" : "保存中…"}
      onConfirm={handleConfirm}
      onClose={onClose}
    />
  );
}
