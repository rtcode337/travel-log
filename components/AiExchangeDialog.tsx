"use client";

import CopyTextButton from "@/components/CopyTextButton";
import type { DiscoveryExchange } from "@/lib/spotDiscovery";

/**
 * 「AIに何を頼んで、何が返ったか」をそのまま見せるダイアログ。
 *
 * **手を入れずに出す**のが要点 —— 整形したり要約したりすると、直したいプロンプトの
 * 実物と食い違う。遅い・少ない・的外れの原因はここを見ないと切り分けられない
 * (プロンプトを直すのか、相手を替えるのか、件数を減らすのかの判断がつかない)。
 *
 * コピーできるようにしてあるのは、**そのまま別の場所へ持っていって試すため**。
 */
export default function AiExchangeDialog({
  exchange,
  backend,
  model,
  onClose,
}: {
  exchange: DiscoveryExchange;
  backend: string | null;
  model: string | null;
  onClose: () => void;
}) {
  const blocks: { title: string; body: string }[] = [
    { title: "system(役割の指示)", body: exchange.system },
    { title: "user(頼んだ本文)", body: exchange.user },
    { title: "返ってきた本文(生のまま)", body: exchange.response },
  ];
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85dvh] w-full max-w-2xl flex-col rounded-2xl bg-white"
      >
        <div className="border-b border-gray-100 p-4">
          <h2 className="font-bold">AIとのやり取り</h2>
          <p className="mt-0.5 text-xs text-gray-500">
            {backend ?? "不明な相手"}
            {model ? `(${model})` : ""} ・ {(exchange.elapsed_ms / 1000).toFixed(1)}秒
          </p>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {blocks.map((block) => (
            <div key={block.title}>
              <div className="mb-1 flex items-center gap-1">
                <h3 className="text-sm font-medium">{block.title}</h3>
                <CopyTextButton text={block.body} label={`${block.title}をコピー`} />
                <span className="text-xs text-gray-400">{block.body.length}字</span>
              </div>
              {/* 折り返しはするが整形はしない(実物と食い違わせない) */}
              <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-gray-50 p-2 text-xs leading-relaxed text-gray-800">
                {block.body || "(空)"}
              </pre>
            </div>
          ))}
        </div>
        <div className="border-t border-gray-100 p-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg border border-gray-300 py-2 text-sm"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}
