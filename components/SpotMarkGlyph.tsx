import type { SpotMark } from "@/lib/spotStyle";

/**
 * ピン・バッジの「中身」(シリーズのアイコン / 文字 / 画像)を描く小さな部品。
 * バッジ(`SpotBadge`)とシリーズの絞り込みチップ(`SeriesFilter`)で共用する ——
 * 同じシリーズが場所によって絵だったり文字だったりしないように、
 * 描き分けは`lib/spotStyle.ts`の解決結果だけに従う。
 */
export default function SpotMarkGlyph({
  mark,
  alt,
  className = "h-3.5 w-3.5",
}: {
  mark: SpotMark;
  /** 画像・アイコンの代替テキスト(シリーズ名) */
  alt: string;
  /** アイコン・画像の大きさ(文字はそのまま親の字送りで出す) */
  className?: string;
}) {
  if (mark.kind === "icon") {
    return (
      // 塗りは親の文字色(面の色に対して読める色が入っている)
      <svg
        viewBox={`0 0 ${mark.icon.viewSize} ${mark.icon.viewSize}`}
        className={className}
        fill="currentColor"
        aria-hidden="true"
      >
        <path d={mark.icon.path} />
      </svg>
    );
  }
  if (mark.kind === "image") {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={mark.src} alt={alt} className={`${className} object-contain`} />;
  }
  if (mark.kind === "text") return <>{mark.text}</>;
  return null;
}
