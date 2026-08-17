"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { formatVisitNoteAt, formatVisitedOn, type Visit, type VisitNote } from "@/lib/types";
import VisitPhotoFields from "@/components/VisitPhotoFields";

/**
 * 訪問記録への追記(`visit_notes`)の入力モーダル。新規追加と編集の両方に使う。
 *
 * **訪問日時の欄は持たない** —— 追記は「いつ書き足したか」が日時で、それは保存した
 * 時刻(`created_at`)そのもの。日時を入れられるようにすると、訪問した日と
 * 書き足した日のどちらを指すのか読めなくなる。
 */
export default function VisitNoteFormModal({
  visit,
  note,
  onClose,
  onSaved,
}: {
  /** 追記先の訪問記録(見出しにその訪問日時を出す) */
  visit: Visit;
  /** 指定すると既存の追記の編集モードになる */
  note?: VisitNote;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [body, setBody] = useState(note?.body ?? "");
  // 各要素は「既存写真の相対パス」または「追加写真のdata URL」(訪問記録と同じ形)
  const [photos, setPhotos] = useState<string[]>(note?.photos ?? []);
  const [processingPhotos, setProcessingPhotos] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // 本文も写真も無い追記は日時だけが残って読めないため、保存させない
    if (!body.trim() && photos.length === 0) {
      setError("本文か写真のどちらかを入れてください。");
      return;
    }
    setSaving(true);
    setError(null);
    const payload = { body: body.trim() || null, photos };
    const { error: saveError } = note
      ? await api.visitNotes.update(note.id, payload)
      : await api.visitNotes.create(visit.id, payload);
    setSaving(false);
    if (saveError) {
      setError("保存に失敗しました: " + saveError.message);
      return;
    }
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-1 font-bold">
          {note ? "追記を編集" : "この訪問記録に追記"}
        </h2>
        <p className="mb-4 text-sm text-gray-500">
          {/* どの訪問に足すのかを出す(1スポットに複数回の記録があるため) */}
          {visit.unvisited && !visit.visited_on
            ? "下調べ"
            : formatVisitedOn(visit.visited_on)}
          の記録
          {note && `・${formatVisitNoteAt(note.created_at)}`}
        </p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium">
              追記(非公開)
            </label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={4}
              autoFocus
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="後から思い出したこと、あとで分かったことなど"
            />
            <p className="mt-1 text-xs text-gray-400">
              {/* 「訪問回数が増えない」ことは、記録を足す前に分かるようにしておく */}
              訪問回数は増えません。元の訪問記録の下に「
              {note ? "追記した日時" : "いまの日時"}に追記」として並びます。
            </p>
          </div>

          <VisitPhotoFields
            photos={photos}
            onPhotosChange={setPhotos}
            onProcessingChange={setProcessingPhotos}
            hint={
              <p className="mb-2 text-xs text-gray-400">
                自分だけに表示されます。元の訪問記録の写真の後ろに並びます。
                <br />
                ※ 保存時に縮小・圧縮されます(長辺1280px・JPEG)。
              </p>
            }
          />

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
      </div>
    </div>
  );
}
