"use client";

import { useState, type ReactNode } from "react";
import type { LatLng } from "@/lib/coords";
import Modal from "@/components/Modal";
import PinPickerMap from "@/components/PinPickerMap";

/**
 * 地図でピンを指して座標を決めるモーダル(`PinPickerMap`の器)。
 * 位置の報告・修正(`SpotRepositionModal`)、訪問記録の「行った場所」、
 * スポットの追加・追加の依頼で写真の位置を確かめるときに共用する。
 *
 * **背景を押しても閉じない**(座標を入力するモーダルの決まり。ピンを動かしている途中で
 * 枠の外に指が触れただけで、指した位置ごと消えるため)。
 * `onConfirm`が文字列を返したら失敗の理由としてモーダルに出し、閉じない。
 */
export default function PickLocationModal({
  title,
  description,
  initial,
  excludeSpotId,
  confirmLabel,
  savingLabel = "保存中…",
  onConfirm,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  /** ピンの最初の位置(地図もここを中心に開く) */
  initial: LatLng;
  /** 近くのスポットから除くスポット(位置を直している当のスポット) */
  excludeSpotId?: string;
  confirmLabel: string;
  savingLabel?: string;
  /**
   * 決めた座標を渡す。失敗したら理由の文字列を返す(同期・非同期のどちらでもよく、
   * 文字列以外を返したら成功として扱う。閉じるのは呼び出し側)
   */
  onConfirm: (pos: LatLng) => unknown;
  onClose: () => void;
}) {
  const [pos, setPos] = useState<LatLng>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfirm = async () => {
    setSaving(true);
    setError(null);
    const failed = await onConfirm(pos);
    setSaving(false);
    if (typeof failed === "string" && failed) setError(failed);
  };

  return (
    <Modal
      onClose={onClose}
      closeOnBackdrop={false}
      zIndexClassName="z-[60]"
      panelClassName="max-h-[90dvh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl bg-white p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          className="text-xl leading-none text-gray-400"
        >
          ✕
        </button>
      </div>
      {description && <div className="text-xs text-gray-500">{description}</div>}
      <PinPickerMap value={pos} onChange={setPos} excludeSpotId={excludeSpotId} />
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
          type="button"
          onClick={handleConfirm}
          disabled={saving}
          className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? savingLabel : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
