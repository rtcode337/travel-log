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
  { path: "account", label: "アカウント", icon: "👤" },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const typeKey = useCurrentSpotTypeKey();
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    if (pathname.startsWith("/login")) return;
    api.auth.me().then(async ({ data }) => {
      if (!data) {
        // Cookieの署名は有効でも、DBを作り直す等でユーザー自体が
        // 既に存在しない場合はここに来る。Cookieを消してログイン画面に戻す
        // (消さないとproxyが「署名は正しい」と判断し/loginへ戻れなくなる)
        await api.auth.logout();
        router.replace("/login");
        return;
      }
      setIsAdmin(SPOT_ADMIN_ROLES.includes(data.role));
    });
  }, [pathname, router]);

  if (pathname.startsWith("/login")) return null;
  // このアプリのページは必ず /[type]/... 形式(ルートの / はログイン後すぐ
  // リダイレクトされる)。typeKeyが無い間はリンク先を組み立てられないので何も出さない
  if (!typeKey) return null;

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white">
      <div className="mx-auto flex max-w-lg items-stretch">
        {items.map((item) => {
          if (item.adminOnly && !isAdmin) return null;
          // 地図・リスト・管理・アカウントタブは、今表示中のスポット種別キーを保ったまま遷移する
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
      </div>
    </nav>
  );
}
