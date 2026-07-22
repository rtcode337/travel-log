"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { getSpotTypeSetting, ROLE_LABELS, type Role, type SpotType } from "@/lib/types";

export default function AccountView({ typeKey }: { typeKey: string }) {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [spotTypes, setSpotTypes] = useState<SpotType[]>([]);
  const [exporting, setExporting] = useState<"current" | "all" | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  useEffect(() => {
    api.auth.me().then(({ data }) => {
      if (!data) return;
      setEmail(data.email);
      setRole(data.role);
    });
    api.spotTypes.list().then(({ data }) => setSpotTypes(data ?? []));
  }, []);

  // public_visible=false(非公開)の種別はAPI側でadmin/spot_admin以外には返らない。
  // 管理者には非公開の種別もリンクを出す
  const currentType = spotTypes.find((t) => t.key === typeKey) ?? null;
  const otherTypes = spotTypes.filter((t) => t.key !== typeKey);

  const handleLogout = async () => {
    await api.auth.logout();
    router.push("/login");
    router.refresh();
  };

  // ZIPバイナリのためapi-client(JSON前提)を使わず直接fetchし、
  // blob化してからaタグのdownloadで保存させる
  const handleExport = async (scope: "current" | "all") => {
    setExporting(scope);
    setExportError(null);
    try {
      const res = await fetch(
        scope === "current"
          ? `/api/visits/export?type=${encodeURIComponent(typeKey)}`
          : "/api/visits/export"
      );
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const filename =
        res.headers
          .get("Content-Disposition")
          ?.match(/filename="([^"]+)"/)?.[1] ?? "travel-log-visits.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setExportError("エクスポートに失敗しました。時間をおいて再度お試しください。");
    } finally {
      setExporting(null);
    }
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

      <section className="mb-4 rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-bold">訪問記録のエクスポート</h2>
        <p className="text-xs text-gray-500">
          自分の訪問記録を、CSV(訪問のメモとスポット情報)と添付写真入りの
          ZIPファイルでダウンロードします。
        </p>
        {exportError && (
          <p className="mt-2 text-xs text-red-600">{exportError}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={() => handleExport("current")}
            disabled={exporting !== null}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 disabled:opacity-50"
          >
            {exporting === "current"
              ? "エクスポート中…"
              : `📦 ${currentType?.label ?? typeKey}のみ`}
          </button>
          <button
            onClick={() => handleExport("all")}
            disabled={exporting !== null}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-700 disabled:opacity-50"
          >
            {exporting === "all" ? "エクスポート中…" : "📦 すべての種別"}
          </button>
        </div>
      </section>

      {otherTypes.length > 0 && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-bold">別のスポットを見る</h2>
          <ul className="divide-y divide-gray-100">
            {otherTypes.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/${t.key}/map`}
                  className="flex items-center justify-between py-2 text-sm text-blue-600"
                >
                  <span>
                    {t.label}
                    {!getSpotTypeSetting(t, "public_visible") && (
                      <span className="ml-1.5 text-xs text-gray-400">
                        (管理者のみ)
                      </span>
                    )}
                  </span>
                  <span className="text-gray-400">›</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
