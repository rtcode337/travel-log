"use client";

import {
  NO_RANK,
  NO_RANK_LABEL,
  NO_RANK_STYLE,
  RANKS,
  RANK_STYLES,
  type RankFilterValue,
} from "@/lib/rank";
import ChoiceRow, { type ChoiceRowOption } from "@/components/ChoiceRow";

/**
 * ランクによる複数選択の絞り込み。**選択中はそのランクの色で塗る**
 * (シリーズの絞り込みと同じ見た目。器は`ChoiceRow`で共通)。
 *
 * 値が決め打ち(A〜E+なし)なので、シリーズと違い**実データに無い段階も出す** ——
 * 「Dが1件も無い」ことは押して0件で分かるほうが、選択肢がデータによって
 * 増減するより読みやすい。
 *
 * 中身はA〜Eの1文字と「なし」だけなので、どれも詰めて並べる(`compact`)。
 */
const OPTIONS: ChoiceRowOption<RankFilterValue>[] = [
  ...RANKS.map((rank) => ({
    value: rank as RankFilterValue,
    content: rank,
    face: RANK_STYLES[rank],
    compact: true,
  })),
  { value: NO_RANK, content: NO_RANK_LABEL, face: NO_RANK_STYLE, compact: true },
];

export default function RankFilter({
  selected,
  onChange,
}: {
  /** 空配列 = 絞り込みなし(「すべて」選択中) */
  selected: RankFilterValue[];
  onChange: (ranks: RankFilterValue[]) => void;
}) {
  return <ChoiceRow options={OPTIONS} selected={selected} onChange={onChange} />;
}
