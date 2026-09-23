"use client";

/**
 * 狭い画面で2カラムの画面を切り替えるタブ。スポット一覧(`SpotsView`)と
 * 管理画面(`AdminView`)で共用する —— 同じ見た目を2か所に書くと、
 * 片方だけ古くなるため(`ChoiceRow`と同じ考え方)。
 *
 * 下線で選択中を示す(丸い塗りつぶしのボタンではなく)。柱を切り替える操作なので、
 * 押すたびに結果が変わるボタンの並びではなく、いまどの柱を見ているのかが読める形にする。
 *
 * 横に溢れたらスクロールさせる(折り返さない)。タブの数と文字数は呼ぶ側で決まり、
 * 「探す: 都道府県」のような長い見出しは狭い端末で1行に収まらない ——
 * 折り返すと下線が途中で切れて、どこまでがタブの並びなのか読めなくなる。
 */
export default function TabBar<T extends string>({
  tabs,
  value,
  onChange,
  className = "",
}: {
  tabs: readonly { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
  /** 出す幅の指定(`sm:hidden`など)。2カラムに切り替わる幅と必ずそろえること */
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`mb-4 flex overflow-x-auto border-b border-gray-200 ${className}`}
    >
      {tabs.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium ${
            value === key
              ? "border-blue-600 text-blue-600"
              : "border-transparent text-gray-500"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
