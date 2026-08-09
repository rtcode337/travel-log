"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { savePlanListDraft } from "@/lib/planListDraft";
import { api } from "@/lib/api-client";
import type { VisitPlanList } from "@/lib/types";

/** 今日のローカル日付(`YYYY-MM-DD`)。開始日の初期値に使う */
function todayKey(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 訪問予定リストの作成・編集モーダル(基本情報の入力)。タイトル・説明(任意)・
 * 訪問予定期間(開始日〜終了日。終了日未入力なら開始日と同じ=単日)を入力する。
 * 出口は2つで、**どちらも基本情報の入力は同じ**:
 *
 * - **保存** …… 経由スポットには触らずその場で保存する(新規はPOST、編集はPATCH)。
 *   タイトルや日付だけ直したいときに地図まで行かなくて済む
 * - **スポットを選ぶ/編集 →** …… 下書きを保存して地図の作成モードへ遷移し、
 *   経由スポットを選んでから保存する(従来の経路)
 *
 * `edit`を渡すと既存リストの編集になる。**編集で「保存」したときは既存の経由
 * スポットをそのまま送り直す** —— PATCHは経由スポットを丸ごと置き換える仕様なので、
 * 送らないとスポットが全部消える。
 */
export default function VisitPlanListFormModal({
  typeKey,
  edit,
  initialSpotIds,
  onClose,
  onSaved,
}: {
  typeKey: string;
  /** 指定すると編集モードになり、そのリストの内容を初期値にする */
  edit?: VisitPlanList;
  /** 新規作成時に最初から入れておく経由スポットのID(スポット詳細からの作成で使う)。
   *  編集モード(`edit`)のときは無視する */
  initialSpotIds?: string[];
  onClose: () => void;
  /** 「保存」で保存し終えたとき。呼び出し元が一覧を読み直すのに使う
   *  (未指定なら閉じるだけ。地図へ遷移する側の出口では呼ばれない) */
  onSaved?: (list: VisitPlanList) => void;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(edit?.title ?? "");
  const [description, setDescription] = useState(edit?.description ?? "");
  const [startDate, setStartDate] = useState(edit?.start_date ?? todayKey());
  // 単日(開始=終了)は終了日欄を空表示にする(新規と同じ扱い)
  const [endDate, setEndDate] = useState(
    edit && edit.end_date !== edit.start_date ? edit.end_date : ""
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /**
   * 入力の検証。通れば正規化した値を、通らなければエラーを出してnullを返す
   * (「保存」と「スポットを選ぶ」で同じ規則を使うため切り出してある)
   */
  const validate = () => {
    const t = title.trim();
    if (!t) {
      setError("タイトルを入力してください。");
      return null;
    }
    if (!startDate) {
      setError("開始日を入力してください。");
      return null;
    }
    // 終了日が空なら開始日と同じ(単日)にする
    const end = endDate || startDate;
    if (end < startDate) {
      setError("終了日は開始日以降にしてください。");
      return null;
    }
    return { title: t, description: description.trim() || null, end };
  };

  /** 経由スポットに触らずその場で保存する(地図へは行かない) */
  const handleSave = async () => {
    const v = validate();
    if (!v) return;
    setSaving(true);
    setError(null);
    const input = {
      title: v.title,
      description: v.description,
      start_date: startDate,
      end_date: v.end,
      // 編集は既存の経由スポットを送り直す(PATCHは丸ごと置き換えるため)。
      // 新規はスポット詳細から渡された種のスポットだけ
      spot_ids: edit?.spot_ids ?? initialSpotIds ?? [],
    };
    const { data, error: err } = edit
      ? await api.visitPlanLists.update(edit.id, input)
      : await api.visitPlanLists.create({ type: typeKey, ...input });
    setSaving(false);
    if (err || !data) {
      setError("保存に失敗しました: " + (err?.message ?? "unknown error"));
      return;
    }
    onSaved?.(data);
    onClose();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const v = validate();
    if (!v) return;
    savePlanListDraft(typeKey, {
      editingId: edit?.id ?? null,
      title: v.title,
      description: v.description,
      start_date: startDate,
      end_date: v.end,
      // 編集時は既存の経由スポットを引き継ぐ。新規作成でスポット詳細から来た場合は
      // そのスポットを最初の経由スポットとして入れておく
      spotIds: edit?.spot_ids ?? initialSpotIds ?? [],
    });
    // 地図の作成モードへ。?buildList=1 でMapViewが下書きを読み込んで作成モードに入る
    router.push(`/${typeKey}/map?buildList=1`);
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
        {/* キャンセルは見出し行の右端に置く(下の行は「保存」と
            「スポットを選ぶ」という前へ進む2つの操作に使うため) */}
        <div className="flex items-start justify-between gap-2">
          <h2 className="font-bold">
            {edit ? "訪問予定リストを編集" : "訪問予定リストを追加"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="キャンセル"
            title="キャンセル"
            className="-mt-1 rounded-full px-2 text-xl leading-none text-gray-400"
          >
            ×
          </button>
        </div>
        <p className="text-xs text-gray-500">
          基本情報だけ保存することも、続けて地図でスポットを
          {edit ? "編集" : "選ぶ"}こともできます。
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium">タイトル *</label>
          <input
            required
            autoComplete="off"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: 夏の北海道旅行"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
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
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-sm font-medium">開始日 *</label>
            <input
              required
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium">終了日</label>
            <input
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-2 py-2 text-sm"
            />
          </div>
        </div>
        <p className="text-xs text-gray-400">
          終了日を空にすると、開始日と同じ日(単日)になります。
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {edit ? "スポットを編集 →" : "スポットを選ぶ →"}
          </button>
        </div>
      </form>
    </div>
  );
}
