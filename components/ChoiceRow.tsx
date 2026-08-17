"use client";

import type { ReactNode } from "react";
import type { SpotFace } from "@/lib/spotStyle";

/**
 * 「すべて」+ 選択肢が横に連なった絞り込みの行。**選択中はその選択肢自身の色で塗る**。
 * シリーズ(`SeriesFilter`)とランク(`RankFilter`)で共用する —— 同じ見た目を
 * 2か所に書くと、片方を直したときにもう片方だけ古い見た目で残るため。
 *
 * **行は常に折り返す。** 選択肢の数は種別の設定で決まる(観光地のシリーズは11個)ので、
 * 1行に収まる前提を置くと狭い画面で最後の選択肢が器から出て**押せなくなる**
 * ——器は`overflow-hidden`なので、はみ出した分は見えないまま切られる。
 * 1つあたりの最小幅は`compact`で選ぶ。
 */
export interface ChoiceRowOption<T extends string> {
  value: T;
  /** ボタンの中身(文字・アイコンなど) */
  content: ReactNode;
  /** 選択中に塗る面。省略時は青(汎用のチップと同じ) */
  face?: SpotFace;
  title?: string;
  /**
   * 中身が短く、折り返す余地の無い選択肢(アイコン・1〜2文字)。詰めて並べる。
   * 既定はカテゴリ名のような長い文字向けの幅で、そちらを狭くすると1文字ずつに潰れる
   */
  compact?: boolean;
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

/**
 * 1つあたりの最小幅(これを下回るときに折り返す)。**`flex-1`ではなく`grow`と組む**
 * ——`flex-1`は`flex-basis: 0`も指定するため、`basis-*`と並べるとどちらが効くかが
 * Tailwindの出力順に左右される
 */
const BASIS = "basis-20";
/** アイコン・1〜2文字用。中身の幅(アイコン16px+左右の余白)にそろえてある */
const BASIS_COMPACT = "basis-9 whitespace-nowrap";

export default function ChoiceRow<T extends string>({
  options,
  selected,
  onChange,
}: {
  options: ChoiceRowOption<T>[];
  /** 空配列 = 絞り込みなし(既定では「すべて」選択中) */
  selected: T[];
  onChange: (selected: T[]) => void;
}) {
  if (options.length === 0) return null;
  // 「すべて」の幅は**その行の選択肢と同じ基準**にする —— 3文字固定なので詰められる
  // (以前はそうしていた)が、名前を出す選択肢の隣に細い「すべて」が並ぶと、
  // 1つだけ幅が違って行の頭が欠けたように見える。詰めるのは選択肢の側も
  // 全部詰めている行(ランクのようにアイコン・1文字だけの行)に限る
  const allBasis = options.every((opt) => opt.compact) ? BASIS_COMPACT : BASIS;
  return (
    // **四隅とも直角**。かつては左端だけ角丸にしていた(枠も rounded-l-lg)——
    // 右端を直角にしているのは、枠が角丸だと overflow-hidden が最後のチップの角を
    // 丸く切ってしまい、そこだけ形が違って見えるため。ただし左右で形が違うほうが
    // 目立つので、角丸をやめて統一した(折り返した2行目以降の先頭も直角でそろう)
    <div className="flex flex-wrap gap-px overflow-hidden border border-gray-300 bg-gray-300 text-sm">
      <button
        type="button"
        onClick={() => onChange([])}
        className={`grow ${allBasis} px-2 py-1.5 font-medium ${
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
            className={`grow ${opt.compact ? BASIS_COMPACT : BASIS} px-2 py-1.5 font-medium ${
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
