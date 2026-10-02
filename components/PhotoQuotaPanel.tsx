"use client";

import { useEffect, useId, useState } from "react";
import { api } from "@/lib/api-client";
import HelpTip from "@/components/HelpTip";

const MB_PER_GB = 1024;

/**
 * 管理画面の「写真の容量の上限」(admin専用)。ユーザーごとに足せる写真の合計の上限を、
 * アプリ全体で1つ決める(`app_settings.photo_quota_mb`)。入力はGB、保存はMB。
 * 0は上限なし。各ユーザーのいまの使用量はユーザー管理の一覧に出る。
 */
export default function PhotoQuotaPanel() {
  const fid = useId();
  const [quotaMb, setQuotaMb] = useState<number | null>(null);
  const [draftGb, setDraftGb] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    api.photoQuota.get().then(({ data, error }) => {
      if (error) {
        setMessage("読み込めませんでした: " + error.message);
        return;
      }
      if (!data) return;
      setQuotaMb(data.quotaMb);
      setDraftGb(String(Math.round((data.quotaMb / MB_PER_GB) * 10) / 10));
    });
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const gb = Number(draftGb);
    if (!Number.isFinite(gb) || gb < 0) {
      setMessage("0以上の数を入れてください(0は上限なし)。");
      return;
    }
    setSaving(true);
    setMessage(null);
    const mb = Math.round(gb * MB_PER_GB);
    const { data, error } = await api.photoQuota.set(mb);
    setSaving(false);
    if (error || !data) {
      setMessage("保存できませんでした: " + (error?.message ?? ""));
      return;
    }
    setQuotaMb(data.quotaMb);
    setMessage(data.quotaMb === 0 ? "上限なしにしました。" : `上限を${gb}GBにしました。`);
  };

  return (
    <details>
      <summary className="cursor-pointer select-none text-base font-bold">
        写真の容量の上限
        <span className="ml-1.5 inline-flex align-middle">
          <HelpTip>
            1人あたりに保存できる写真の合計の上限。全員に同じ値が効く。超える写真は
            保存のときに断られ、利用者には理由と使用量が出る(すでに超えている写真は
            消えない)。0にすると上限なし。各ユーザーのいまの使用量は「ユーザー管理」の
            一覧と、本人のアカウント画面に出る。
          </HelpTip>
        </span>
      </summary>
      <form onSubmit={handleSave} className="mt-2 rounded-xl border border-gray-200 bg-white p-4">
        <label htmlFor={`${fid}-quota`} className="mb-1 block text-sm font-medium">
          1人あたりの上限(GB。0は上限なし)
        </label>
        <div className="flex items-center gap-2">
          <input
            id={`${fid}-quota`}
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={draftGb}
            onChange={(e) => setDraftGb(e.target.value)}
            disabled={quotaMb === null}
            className="w-32 rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
          <span className="text-sm text-gray-600">GB</span>
          <button
            type="submit"
            disabled={saving || quotaMb === null}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
        {message && <p className="mt-2 text-sm text-gray-700">{message}</p>}
      </form>
    </details>
  );
}
