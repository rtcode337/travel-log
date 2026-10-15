"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import NavBar from "@/components/NavBar";

/**
 * 下タブ(NavBar)の表示を制御するためのコンテキスト。訪問予定リストの作成中は
 * 誤って別タブへ移動して入力中の内容を失わないよう、下タブを隠す。
 * MapViewが作成モードのon/offに合わせて`setHideNav`を呼ぶ。
 */
const NavVisibilityContext = createContext<{
  hideNav: boolean;
  setHideNav: (v: boolean) => void;
}>({ hideNav: false, setHideNav: () => {} });

export function useNavVisibility() {
  return useContext(NavVisibilityContext);
}

/**
 * 画面の骨組み。`body`(画面の高さちょうどの縦並び。`app/layout.tsx`)の中に、
 * **スクロールする中身の領域**と**下タブ**を縦に並べる。
 *
 * **下タブは`fixed`にしない。** iPhoneのホーム画面から開いた状態では、`fixed`の基準の枠
 * (layout viewport)がキーボードを閉じたあとなどに古い位置・高さのまま残り、帯が画面の
 * 途中に取り残された。visualViewportを読んでJSで置き直す方式も試したが、値が古いまま
 * 残る経路(選択肢を開いた後・別のアプリでキーボードを出したまま切り替えて来たとき等)が
 * 次々見つかり継ぎ足しになった。**ページ全体はスクロールさせず中の領域だけを
 * スクロールさせ、帯は縦並びの最後の要素に置く**と、帯はただの通常の流れの箱なので
 * 枠のずれに巻き込まれない。
 *
 * そのため**ページのスクロールは`window`ではなくこの中身の領域で起きる**。
 * `window.scrollTo`・`window`の`scroll`イベント・`sticky`の見出しなどを足すときは
 * この領域を基準にすること。
 */
export default function AppFrame({ children }: { children: React.ReactNode }) {
  const [hideNav, setHideNav] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  // 画面を移ったら中身の領域を先頭へ戻す。この領域はルートのレイアウトにあって画面を
  // 跨いで使い回されるので、何もしないと前の画面のスクロール位置のまま次の画面が出る
  // (ページ全体をスクロールさせていたころは、Next.jsが`window`を先頭へ戻していた)。
  // パスが変わったときだけ戻す ——`?region=`のようなクエリの書き換えでは戻さない
  // biome-ignore lint/correctness/useExhaustiveDependencies: パスが変わったことだけを合図にする
  useEffect(() => {
    scrollRef.current?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <NavVisibilityContext.Provider value={{ hideNav, setHideNav }}>
      {/* min-h-0 が無いと、中身の高さに引っ張られて領域が伸び、中でスクロールしない */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        {children}
      </div>
      {!hideNav && <NavBar />}
    </NavVisibilityContext.Provider>
  );
}
