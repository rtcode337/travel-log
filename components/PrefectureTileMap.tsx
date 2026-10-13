"use client";

import { PREFECTURES } from "@/lib/types";

/**
 * 47都道府県を日本の形に並べたマス目(タイル)。マスの色の濃さで「その県のスポットの
 * うち行った割合」を、灰色で「まだ1か所も行っていない」を示す。
 *
 * **縦に47行並べたリストの置き換え**。リストでは「どこに行ったか」を読むのに
 * 全部スクロールして数字を拾う必要があったが、形で並べれば一目で塗り絵として見える。
 * 押すと、その県のスポット一覧に入る(リストのときと同じ)。
 *
 * マスに件数は書かない —— 狭い画面では1マスが25px前後しかなく、「12/160」が入らない。
 * 件数は押した先の見出しと、マスのtitleに出す。
 */

/** [行, 列]。12×12のマス目に、おおよその地理の位置で置く(形の見当がつけばよい) */
const TILE_POSITIONS: Record<(typeof PREFECTURES)[number], [number, number]> = {
  北海道: [0, 11],
  青森県: [1, 10],
  秋田県: [2, 9],
  岩手県: [2, 10],
  山形県: [3, 9],
  宮城県: [3, 10],
  石川県: [4, 6],
  富山県: [4, 7],
  新潟県: [4, 8],
  福島県: [4, 9],
  福井県: [5, 5],
  岐阜県: [5, 6],
  長野県: [5, 7],
  群馬県: [5, 8],
  栃木県: [5, 9],
  茨城県: [5, 10],
  山口県: [6, 0],
  島根県: [6, 1],
  鳥取県: [6, 2],
  兵庫県: [6, 3],
  京都府: [6, 4],
  滋賀県: [6, 5],
  愛知県: [6, 6],
  山梨県: [6, 7],
  埼玉県: [6, 8],
  千葉県: [6, 9],
  福岡県: [7, 0],
  広島県: [7, 1],
  岡山県: [7, 2],
  大阪府: [7, 3],
  奈良県: [7, 4],
  三重県: [7, 5],
  静岡県: [7, 6],
  神奈川県: [7, 7],
  東京都: [7, 8],
  佐賀県: [8, 0],
  大分県: [8, 1],
  愛媛県: [8, 2],
  香川県: [8, 3],
  和歌山県: [8, 4],
  長崎県: [9, 0],
  熊本県: [9, 1],
  高知県: [9, 2],
  徳島県: [9, 3],
  宮崎県: [10, 1],
  鹿児島県: [10, 0],
  沖縄県: [11, 0],
};

/** マスに書く短い名前。「県」「府」「都」を落とし、3字残るもの(北海道・神奈川など)は
 * 頭の2字にする —— 狭い画面のマスには3字が入らない */
function shortName(pref: string): string {
  const name = pref.replace(/[都府県]$/, "");
  return name.length > 2 ? name.slice(0, 2) : name;
}

/** 行った割合ごとの色。0件は灰色、全部行ったら一番濃い緑 */
function tileClass(visited: number, total: number): string {
  if (total === 0) return "border border-dashed border-gray-200 bg-white text-gray-300";
  if (visited === 0) return "bg-gray-100 text-gray-500";
  if (visited >= total) return "bg-green-700 text-white";
  const ratio = visited / total;
  if (ratio < 0.15) return "bg-green-100 text-green-800";
  if (ratio < 0.4) return "bg-green-300 text-green-900";
  return "bg-green-500 text-white";
}

const LEGEND: { label: string; className: string }[] = [
  { label: "未訪問", className: "bg-gray-100" },
  { label: "少し", className: "bg-green-100" },
  { label: "そこそこ", className: "bg-green-300" },
  { label: "半分近く", className: "bg-green-500" },
  { label: "全部", className: "bg-green-700" },
];

export default function PrefectureTileMap({
  rows,
  onSelect,
}: {
  /** 都道府県ごとの件数(スポットのある県だけ。無い県は空のマスで出す) */
  rows: { region: string; total: number; visited: number }[];
  onSelect: (region: string) => void;
}) {
  const byRegion = new Map(rows.map((r) => [r.region, r]));
  const withSpots = PREFECTURES.filter((p) => (byRegion.get(p)?.total ?? 0) > 0);
  const wentCount = withSpots.filter((p) => (byRegion.get(p)?.visited ?? 0) > 0).length;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3">
      <p className="mb-2 text-sm text-gray-600">
        <span className="text-lg font-bold text-green-700">{wentCount}</span> /{" "}
        {withSpots.length} {withSpots.length === PREFECTURES.length ? "都道府県" : "都道府県(スポットのある県)"}
        に行った
      </p>
      <div className="grid grid-cols-12 gap-[3px]">
        {PREFECTURES.map((pref) => {
          const [row, col] = TILE_POSITIONS[pref];
          const { total, visited } = byRegion.get(pref) ?? { total: 0, visited: 0 };
          return (
            <button
              key={pref}
              type="button"
              disabled={total === 0}
              onClick={() => onSelect(pref)}
              title={total === 0 ? `${pref}(スポットなし)` : `${pref} ✓ ${visited} / ${total} 件`}
              aria-label={total === 0 ? `${pref}(スポットなし)` : `${pref} 行った ${visited} / ${total} 件`}
              style={{ gridRow: row + 1, gridColumn: col + 1 }}
              className={`flex aspect-square items-center justify-center rounded text-[9px] leading-none font-medium sm:text-[11px] ${tileClass(visited, total)} ${total > 0 ? "hover:ring-2 hover:ring-blue-400" : ""}`}
            >
              {shortName(pref)}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
        {LEGEND.map((l) => (
          <span key={l.label} className="flex items-center gap-1">
            <span className={`inline-block size-3 rounded-sm ${l.className}`} />
            {l.label}
          </span>
        ))}
      </div>
    </div>
  );
}
