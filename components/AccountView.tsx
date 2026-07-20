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
