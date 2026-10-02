"use client";

import { useEffect, useState, useId } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { ROLE_LABELS, type Role, type SpotType } from "@/lib/types";
import { useExportJobs } from "@/lib/useExportJobs";
import { formatJstDateTime } from "@/lib/datetime";
import { formatBytes } from "@/lib/bytes";

export default function AccountView({ typeKey }: { typeKey: string }) {
  // ラベルと入力欄を結ぶid(同じ画面に同じ部品が複数出ても重ならないように)
  const fid = useId();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [spotTypes, setSpotTypes] = useState<SpotType[]>([]);
  // 管理者が自分あてに作った訪問記録のZIP(APIが自分のぶんだけ返す)。
  // 作成中の追いかけはフックが持つので、待っている間にリロードは要らない
  const { jobs: exportJobs } = useExportJobs();
  const exportJob = exportJobs[0] ?? null;

  const [photoUsage, setPhotoUsage] = useState<{
    usedBytes: number;
    photoCount: number;
    quotaBytes: number | null;
  } | null>(null);
  useEffect(() => {
    api.auth.me().then(({ data }) => {
      if (!data) return;
      setEmail(data.email);
      setRole(data.role);
    });
    api.spotTypes.list().then(({ data }) => setSpotTypes(data ?? []));
    // 使用量は数えるのに時間がかかることがあるので、ほかの表示を待たせない
    api.account.photoUsage().then(({ data }) => setPhotoUsage(data ?? null));
  }, []);

  const currentType = spotTypes.find((t) => t.key === typeKey) ?? null;

  const handleLogoutAll = async () => {
    if (!confirm("ほかの端末も含めて、すべてのログインを終了しますか?")) return;
    const { error } = await api.auth.logoutAll();
    if (error) {
      alert("ログアウトできませんでした: " + error.message);
      return;
    }
    router.push("/login");
    router.refresh();
  };

  const handleLogout = async () => {
    await api.auth.logout();
    router.push("/login");
    router.refresh();
  };

  // アカウント削除は取り消せないので、メールアドレスを打ち直させてから実行する
  // (confirm()1つだと誤タップで消える)
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountInput, setDeleteAccountInput] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);

  const handleDeleteAccount = async () => {
    setDeletingAccount(true);
    setDeleteAccountError(null);
    const { error } = await api.account.remove();
    setDeletingAccount(false);
    if (error) {
      setDeleteAccountError(error.message);
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
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
          >
            🚪 ログアウト
          </button>
          {/* ログアウトはこの端末のCookieを消すだけなので、他の端末に残ったログインや
              漏れたCookieはこちらで取り消す */}
          <button
            type="button"
            onClick={handleLogoutAll}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
          >
            すべての端末からログアウト
          </button>
        </div>
      </section>

      {/* 写真の使用量。上限は環境ごと(PHOTO_QUOTA_MB)で、超える追加は保存のときに断られる。
          どれだけ使っているかが分からないと、断られて初めて上限を知ることになる */}
      {photoUsage && (
        <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-sm font-bold">写真の容量</h2>
          <p className="mt-1 text-sm text-gray-700">
            {formatBytes(photoUsage.usedBytes)}
            {photoUsage.quotaBytes !== null && <> / {formatBytes(photoUsage.quotaBytes)}</>}
            <span className="ml-2 text-xs text-gray-500">(写真 {photoUsage.photoCount.toLocaleString("ja-JP")} 枚)</span>
          </p>
          {photoUsage.quotaBytes !== null ? (
            (() => {
              const ratio = Math.min(1, photoUsage.usedBytes / photoUsage.quotaBytes);
              return (
                <>
                  <div
                    className="mt-2 h-2 overflow-hidden rounded-full bg-gray-100"
                    role="progressbar"
                    aria-label="写真の容量の使用率"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(ratio * 100)}
                  >
                    <div
                      className={`h-full ${ratio >= 0.9 ? "bg-red-500" : ratio >= 0.7 ? "bg-amber-500" : "bg-blue-500"}`}
                      style={{ width: `${ratio * 100}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-gray-500">
                    上限を超える写真は追加できません。訪問記録や追記から写真を外すと空きます。
                  </p>
                </>
              );
            })()
          ) : (
            <p className="mt-1 text-xs text-gray-500">この環境では上限はありません。</p>
          )}
        </section>
      )}

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
                {formatJstDateTime(exportJob.created_at)}に作成 ・{" "}
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
        <h2 className="text-sm font-bold text-red-700">アカウント削除</h2>
        <p className="mt-0.5 text-xs text-gray-500">
          アカウントと、訪問記録・写真・訪問予定・口コミ・非公開スポットを削除します。
          <strong>取り消せません。</strong>
          <br />
          あなたが登録した公開スポットは、登録者の情報だけを外して残ります
          (他のユーザーの地図から消さないため)。
        </p>
        {!deleteAccountOpen ? (
          <button
            type="button"
            onClick={() => setDeleteAccountOpen(true)}
            className="mt-3 rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-700"
          >
            アカウントを削除する
          </button>
        ) : (
          <div className="mt-3">
            <label htmlFor={`${fid}-confirm-email`} className="block text-xs text-gray-600">
              確認のため、ご自身のメールアドレス({email})を入力してください。
            </label>
            <input
              id={`${fid}-confirm-email`}
              type="email"
              value={deleteAccountInput}
              onChange={(e) => setDeleteAccountInput(e.target.value)}
              autoComplete="off"
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            {deleteAccountError && (
              <p className="mt-1 text-xs text-red-600">{deleteAccountError}</p>
            )}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setDeleteAccountOpen(false);
                  setDeleteAccountInput("");
                  setDeleteAccountError(null);
                }}
                className="flex-1 rounded-lg border border-gray-300 py-2 text-sm"
              >
                やめる
              </button>
              <button
                type="button"
                onClick={handleDeleteAccount}
                disabled={deletingAccount || !email || deleteAccountInput.trim() !== email}
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {deletingAccount ? "削除中…" : "完全に削除する"}
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
