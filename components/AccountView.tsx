"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { ROLE_LABELS, type Role, type SpotType } from "@/lib/types";
import { useExportJobs } from "@/lib/useExportJobs";

export default function AccountView({ typeKey }: { typeKey: string }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [spotTypes, setSpotTypes] = useState<SpotType[]>([]);
  // 管理者が自分あてに作った訪問記録のZIP(APIが自分のぶんだけ返す)。
  // 作成中の追いかけはフックが持つので、待っている間にリロードは要らない
  const { jobs: exportJobs } = useExportJobs();
  const exportJob = exportJobs[0] ?? null;

  useEffect(() => {
    api.auth.me().then(({ data }) => {
      if (!data) return;
      setEmail(data.email);
      setRole(data.role);
    });
    api.spotTypes.list().then(({ data }) => setSpotTypes(data ?? []));
  }, []);

  const currentType = spotTypes.find((t) => t.key === typeKey) ?? null;

  const handleLogout = async () => {
    await api.auth.logout();
    router.push("/login");
    router.refresh();
  };

  // 退会は取り消せないので、メールアドレスを打ち直させてから実行する
  // (confirm()1つだと誤タップで消える)
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawInput, setWithdrawInput] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const handleWithdraw = async () => {
    setWithdrawing(true);
    setWithdrawError(null);
    const { error } = await api.account.remove();
    setWithdrawing(false);
    if (error) {
      setWithdrawError(error.message);
      return;
    }
    router.push("/login");
    router.refresh();
  };

  return (
    <main className="mx-auto max-w-lg p-4">
      <h1 className="mb-4 text-lg font-bold">アカウント</h1>

      <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        {email && <p className="text-sm font-medium">{email}</p>}
        {role && (
          <p className="mt-0.5 text-xs text-gray-500">{ROLE_LABELS[role]}</p>
        )}
        {currentType && (
          <p className="mt-2 text-xs text-gray-400">
            現在のモード: {currentType.label}
          </p>
        )}
        <button
          onClick={handleLogout}
          className="mt-3 flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
        >
          🚪 ログアウト
        </button>
      </section>

      {/* 管理者が作った自分の訪問記録のZIP。作成は管理画面からしかできないので、
          何も無いときは節ごと出さない(ここに作成ボタンは置かない)。
          作成中はその旨を出し、出来上がったらリロードなしでボタンに変わる */}
      {exportJob && exportJob.status !== "failed" && (
        <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-bold">訪問記録のエクスポート</h2>
          {exportJob.status === "running" ? (
            <p className="mt-0.5 text-xs text-gray-500">
              管理者が作成中です。出来上がるとここからダウンロードできます。
            </p>
          ) : (
            <>
              <p className="mt-0.5 text-xs text-gray-500">
                {new Date(exportJob.created_at).toLocaleString("ja-JP")}に作成 ・{" "}
                {exportJob.visit_count}件の記録 / 写真{exportJob.photo_count}枚
              </p>
              <a
                href={api.exports.downloadUrl(exportJob.id)}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
              >
                ⬇ ZIPをダウンロード
              </a>
            </>
          )}
        </section>
      )}
      <section className="mb-4 rounded-xl border border-red-200 bg-white p-4">
        <h2 className="text-sm font-bold text-red-700">退会</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          アカウントと、訪問記録・写真・訪問予定・口コミ・非公開スポットを削除します。
          <strong>取り消せません。</strong>
          <br />
          あなたが登録した公開スポットは、登録者の情報だけを外して残ります
          (他のユーザーの地図から消さないため)。
        </p>
        {!withdrawOpen ? (
          <button
            type="button"
            onClick={() => setWithdrawOpen(true)}
            className="mt-3 rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700"
          >
            退会する
          </button>
        ) : (
          <div className="mt-3">
            <label className="block text-xs text-gray-600">
              確認のため、ご自身のメールアドレス({email})を入力してください。
            </label>
            <input
              type="email"
              value={withdrawInput}
              onChange={(e) => setWithdrawInput(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            {withdrawError && (
              <p className="mt-1 text-xs text-red-600">{withdrawError}</p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setWithdrawOpen(false);
                  setWithdrawInput("");
                  setWithdrawError(null);
                }}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm"
              >
                やめる
              </button>
              <button
                type="button"
                onClick={handleWithdraw}
                disabled={withdrawing || !email || withdrawInput.trim() !== email}
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {withdrawing ? "削除中…" : "完全に削除する"}
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
