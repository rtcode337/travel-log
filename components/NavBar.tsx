"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useCurrentSpotTypeKey } from "@/lib/useSpotTypeKey";

const items = [
  { href: "/map", label: "地図", icon: "🗺️", typed: true },
  { href: "/spots", label: "リスト", icon: "📋", typed: true },
  { href: "/admin", label: "管理", icon: "⚙️", adminOnly: true },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const typeKey = useCurrentSpotTypeKey();
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [activeTypeLabel, setActiveTypeLabel] = useState<string | null>(null);
  const [showUserMenu, setShowUserMenu] = useState(false);

  useEffect(() => {
    if (pathname.startsWith("/login")) return;
    api.auth.me().then(async ({ data }) => {
      if (!data) {
        // Cookieの署名は有効でも、DBを作り直す等でユーザー自体が
        // 既に存在しない場合はここに来る。Cookieを消してログイン画面に戻す
        // (消さないとmiddlewareが「署名は正しい」と判断し/loginへ戻れなくなる)
        await api.auth.logout();
        router.replace("/login");
        return;
      }
      setIsAdmin(data.role === "admin");
      setEmail(data.email);
    });
    api.appSettings.get().then(({ data }) => setActiveTypeLabel(data?.label ?? null));
  }, [pathname, router]);

  if (pathname.startsWith("/login")) return null;

  const handleLogout = async () => {
    await api.auth.logout();
    router.push("/login");
    router.refresh();
  };

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white">
        <div className="mx-auto flex max-w-lg items-stretch">
          {items.map((item) => {
            if (item.adminOnly && !isAdmin) return null;
            // 地図・リストタブは、今表示中のスポット種類キーを保ったまま遷移する
            const href = item.typed && typeKey ? `/${typeKey}${item.href}` : item.href;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={item.href}
                href={href}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
                  active ? "font-bold text-blue-600" : "text-gray-500"
                }`}
              >
                <span className="text-lg leading-none">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* ユーザーメニュー(左下固定) */}
      {showUserMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowUserMenu(false)}
          />
          <div className="fixed bottom-36 left-4 z-50 w-56 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
            {(email || activeTypeLabel) && (
              <div className="truncate border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
                {email && <p className="truncate">{email}</p>}
                {activeTypeLabel && (
                  <p className="mt-0.5 text-gray-400">
                    現在のモード: {activeTypeLabel}
                  </p>
                )}
              </div>
            )}
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
            >
              🚪 ログアウト
            </button>
          </div>
        </>
      )}
      <button
        onClick={() => setShowUserMenu((v) => !v)}
        className="fixed bottom-20 left-4 z-50 flex h-11 w-11 items-center justify-center rounded-full bg-gray-800 text-lg text-white shadow-lg"
        aria-label="ユーザーメニュー"
      >
        👤
      </button>
    </>
  );
}
