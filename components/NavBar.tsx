"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const items = [
  { href: "/map", label: "地図", icon: "🗺️" },
  { href: "/spots", label: "リスト", icon: "📋" },
  { href: "/admin", label: "管理", icon: "⚙️" },
];

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname.startsWith("/login")) return null;

  const handleLogout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-200 bg-white">
      <div className="mx-auto flex max-w-lg items-stretch">
        {items.map((item) => {
          const active =
            item.href === "/spots"
              ? pathname === "/spots" || pathname.startsWith("/spots/")
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
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
          onClick={handleLogout}
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs text-gray-500"
        >
          <span className="text-lg leading-none">🚪</span>
          ログアウト
        </button>
      </div>
    </nav>
  );
}
