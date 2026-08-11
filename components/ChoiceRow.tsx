"use client";

import type { ReactNode } from "react";
import type { SpotFace } from "@/lib/spotStyle";

/**
 * 「すべて」+ 選択肢が横に連なった絞り込みの行。**選択中はその選択肢自身の色で塗る**。
 * シリーズ(`SeriesFilter`)とランク(`RankFilter`)で共用する —— 同じ見た目を
 * 2か所に書くと、片方を直したときにもう片方だけ古い見た目で残るため。
 */
export interface ChoiceRowOption<T extends string> {
  value: T;
  /** ボタンの中身(文字・アイコンなど) */
  content: ReactNode;
  /** 選択中に塗る面。省略時は青(汎用のチップと同じ) */
  face?: SpotFace;
  title?: string;
}

/**
 * 「すべて」(空配列)の状態から特定の1件を選ぶと、それ単独の絞り込みになる
 * (他をすべて手で外す手間を省くため)。それ以外は通常のトグル(追加/除外)。
 */
export function toggleChoice<T extends string>(current: T[], clicked: T): T[] {
  if (current.length === 0) return [clicked];
  return current.includes(clicked)
    ? current.filter((v) => v !== clicked)
    : [...current, clicked];
}

export default function ChoiceRow<T extends string>({
  options,
  selected,
  onChange,
  wrap = false,
}: {
  options: ChoiceRowOption<T>[];
  /** 空配列 = 絞り込みなし(既定では「すべて」選択中) */
  selected: T[];
  onChange: (selected: T[]) => void;
  /**
   * 折り返しを許す(選択肢が多い・名前が長い軸向け)。
   * 1行に詰め込むと1つあたりの幅が足りず、文字が数字1つ分まで潰れるため
   */
  wrap?: boolean;
}) {
  if (options.length === 0) return null;
  return (
    <div
      className={`flex overflow-hidden rounded-l-lg border border-gray-300 bg-gray-300 text-sm ${
        wrap ? "flex-wrap gap-px" : "gap-px"
      }`}
    >
      <button
        type="button"
        onClick={() => onChange([])}
        // 角丸は左端だけ(枠も rounded-l-lg)。**右端は直角**にする ——
        // 枠が角丸だと overflow-hidden が最後のチップの角を丸く切ってしまい、
        // そこだけ形が違って見えるため
        className={`flex-1 rounded-l-lg px-2 py-1.5 font-medium ${wrap ? "basis-20 " : ""}${
          selected.length === 0
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
        }`}
      >
        すべて
      </button>
      {options.map((opt) => {
        const active = selected.includes(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            title={opt.title}
            onClick={() => onChange(toggleChoice(selected, opt.value))}
            // 選択中はその選択肢の色で塗る。**未選択側を灰色にしてある**のは、
            // 白い選択肢(シリーズ未設定・ランクなし)だと塗っても地の白と同じで、
            // 選んだかどうかが分からなくなるため。あわせて選択中は下辺に
            // 縁取り色の帯を敷き、白でも選択が分かるようにする
            // (**四辺を囲むリングにはしない** —— 1つ1つが独立した四角の箱に
            //  見えて、ひと続きの切り替えとして読めなくなる)
            style={
              active && opt.face
                ? {
                    backgroundColor: opt.face.color,
                    color: opt.face.textColor,
                    boxShadow: `inset 0 -3px 0 ${opt.face.borderColor}`,
                  }
                : undefined
            }
            className={`flex-1 px-2 py-1.5 font-medium ${wrap ? "basis-20 " : ""}${
              active
                ? opt.face
                  ? ""
                  : "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-gray-200"
            }`}
          >
            {opt.content}
          </button>
        );
      })}
    </div>
  );
}
