"use client";

import { createContext, useContext, useState } from "react";
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

export default function AppFrame({ children }: { children: React.ReactNode }) {
  const [hideNav, setHideNav] = useState(false);
  return (
    <NavVisibilityContext.Provider value={{ hideNav, setHideNav }}>
      {/* 下タブ(pb-16)ぶんの余白は、下タブを隠しているときは取らない */}
      <div className={`flex-1 ${hideNav ? "" : "pb-16"}`}>{children}</div>
      {!hideNav && <NavBar />}
    </NavVisibilityContext.Provider>
  );
}
