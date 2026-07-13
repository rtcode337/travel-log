"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";
import { useCurrentSpotTypeKey } from "@/lib/useSpotTypeKey";
import { SPOT_ADMIN_ROLES } from "@/lib/types";

const items = [
  { path: "map", label: "地図", icon: "🗺️" },
  { path: "spots", label: "スポット", icon: "📍" },
  { path: "admin", label: "管理", icon: "⚙️", adminOnly: true },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const typeKey = useCurrentSpotTypeKey();
  const [isAdmin, setIsAdmin] = useState(false);
  const [email, setEmail] = useState<string | null>(null);
  const [currentTypeLabel, setCurrentTypeLabel] = useState<string | null>(null);
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
      setIsAdmin(SPOT_ADMIN_ROLES.includes(data.role));
      setEmail(data.email);
    });
    // 「現在のモード」は(app_settingsの既定ではなく)今見ているURLのスポット種類を表示する
    if (typeKey) {
      api.spotTypes
        .list()
        .then(({ data }) => setCurrentTypeLabel(data?.find((t) => t.key === typeKey)?.label ?? null));
    }
  }, [pathname, router, typeKey]);

  if (pathname.startsWith("/login")) return null;
  // このアプリのページは必ず /[type]/... 形式(ルートの / はログイン後すぐ
  // リダイレクトされる)。typeKeyが無い間はリンク先を組み立てられないので何も出さない
  if (!typeKey) return null;

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
            // 地図・リスト・管理タブは、今表示中のスポット種類キーを保ったまま遷移する
            const href = `/${typeKey}/${item.path}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={item.path}
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
          <button
            type="button"
            onClick={() => setShowUserMenu((v) => !v)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-xs ${
              showUserMenu ? "font-bold text-blue-600" : "text-gray-500"
            }`}
            aria-label="アカウントメニュー"
          >
            <span className="text-lg leading-none">👤</span>
            アカウント
          </button>
        </div>
      </nav>

      {/* アカウントメニュー(タブバー右端の上に表示。画面外にはみ出さないよう右端基準+幅を画面内に収める) */}
      {showUserMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowUserMenu(false)}
          />
          <div className="fixed bottom-16 right-2 z-50 w-56 max-w-[calc(100vw-1rem)] rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
            {(email || currentTypeLabel) && (
              <div className="truncate border-b border-gray-100 px-4 py-2 text-xs text-gray-500">
                {email && <p className="truncate">{email}</p>}
                {currentTypeLabel && (
                  <p className="mt-0.5 text-gray-400">
                    現在のモード: {currentTypeLabel}
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
    </>
  );
}
