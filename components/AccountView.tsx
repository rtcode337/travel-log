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
    </main>
  );
}
