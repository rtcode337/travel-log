"use client";

import { useEffect, useState } from "react";

/**
 * WikipediaのREST API(page/summary)のレスポンスのうち、表示に使う部分。
 * 参照先の言語版はスポット種別ごとのwikipedia_lang設定(既定'ja')で切り替える。
 * https://ja.wikipedia.org/api/rest_v1/#/Page%20content/get_page_summary__title_
 */
interface WikiSummary {
  title: string;
  extract: string;
  type: string;
  thumbnail?: { source: string };
  originalimage?: { source: string };
  content_urls?: { desktop?: { page?: string } };
}

interface WikiSearchResponse {
  query?: { search?: { title: string }[] };
}

interface WikiLinksResponse {
  query?: { pages?: { links?: { title: string }[] }[] };
}

interface WikiQueryTitlesResponse {
  query?: {
    redirects?: { from: string; to: string }[];
    normalized?: { from: string; to: string }[];
    pages?: { title: string; missing?: boolean }[];
  };
}

/** タイトル比較用に番地・記号類を除いたコア文字列を作る */
function coreOf(name: string): string {
  return name.replace(/[0-9０-９]+番館?|[・･、,()（）\s　]/g, "");
}

/**
 * iOSのPWA(スタンドアロン起動)かどうか。この状態のiOSでは`target="_blank"`が
 * 本物のSafariではなくアプリ内ブラウザ(閉じるボタン付きのオーバーレイ)で開かれる。
 * iPadOSはUAが`Macintosh`になるためタッチ点数でも判定する
 */
function isIosStandalone(): boolean {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari独自プロパティ(型定義に無い)
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return standalone && ios;
}

/**
 * スポット名と完全一致する記事(またはそのリダイレクト先)があればタイトルを返す。
 * 「森戸神社」の正式記事名が「森戸大明神」であるような、通称/正式名称の食い違いは
 * 全文検索の文字列一致だけでは拾えないため、まずこちらで解決を試みる
 */
async function resolveExactTitle(
  lang: string,
  spotName: string
): Promise<string | null> {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&redirects=1&format=json&formatversion=2&origin=*&titles=` +
    encodeURIComponent(spotName);
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as WikiQueryTitlesResponse;
  const normalized = json.query?.normalized?.[0]?.to ?? spotName;
  const redirected = json.query?.redirects?.[0]?.to ?? normalized;
  const found = json.query?.pages?.find((p) => !p.missing);
  return found ? redirected : null;
}

/**
 * MediaWiki Action APIでスポット名だけを検索する。所在地(都道府県・市区町村)を
 * クエリに混ぜると、スポット自体の記事が無い場合に市区町村や「〇〇県出身の人物一覧」
 * のような無関係な記事が上位に来やすいため、名前単体で検索したうえで、上位数件の中から
 * タイトルにスポット名が含まれるものだけを採用する(同名の別記事の誤爆を避ける)
 */
async function searchWikiTitle(
  lang: string,
  spotName: string
): Promise<string | null> {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*` +
    `&srlimit=5&srsearch=${encodeURIComponent(spotName)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`検索に失敗しました (${res.status})`);
  const json = (await res.json()) as WikiSearchResponse;
  const results = json.query?.search ?? [];
  const core = coreOf(spotName);
  if (core.length < 2) return results[0]?.title ?? null;
  const match = results.find((r) => coreOf(r.title).includes(core));
  return match?.title ?? null;
}

async function fetchWikiSummary(lang: string, title: string): Promise<WikiSummary> {
  const res = await fetch(
    `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      title.replace(/ /g, "_")
    )}`
  );
  if (!res.ok) throw new Error(`記事の取得に失敗しました (${res.status})`);
  return (await res.json()) as WikiSummary;
}

/**
 * 曖昧さ回避ページのリンク先から、スポット名を含みかつ地域も一致するタイトルを選ぶ
 * (曖昧さ回避ページは大抵「〇〇 (△△市)」のように所在地を括弧書きしたリンクを
 * 列挙しているが、地名単体へのリンクも別途混ざっているため、スポット名を含まない
 * リンク=「伊勢原市」のような地名ページ自体は候補から除く)
 */
async function resolveDisambiguation(
  lang: string,
  disambigTitle: string,
  spotName: string,
  region: string
): Promise<string | null> {
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&prop=links&pllimit=500&plnamespace=0&format=json&formatversion=2&origin=*&titles=` +
    encodeURIComponent(disambigTitle);
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as WikiLinksResponse;
  const core = coreOf(spotName);
  const candidates = json.query?.pages?.[0]?.links?.filter((l) =>
    coreOf(l.title).includes(core)
  ) ?? [];
  const byRegion = candidates.find((l) => l.title.includes(region));
  return (byRegion || candidates[0])?.title ?? null;
}

/**
 * スポット名+所在地からWikipediaの記事を検索し、代表画像と概要をモーダルで表示する。
 * 参照する言語版はスポット種別ごとのwikipedia_lang設定(既定'ja')に従う。
 * 名前による自動検索のため、同名の別の場所がヒットする可能性がある点は画面上でも注記する。
 */
export default function SpotInfoModal({
  spotName,
  region,
  lang,
  onClose,
}: {
  spotName: string;
  /** 地域(都道府県/州・県/国)。表示と曖昧さ回避ページの解決に使う */
  region: string;
  /** 参照するWikipediaの言語版(サブドメイン)。例: 'ja'、'en' */
  lang: string;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState<WikiSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const title =
          (await resolveExactTitle(lang, spotName)) ??
          (await searchWikiTitle(lang, spotName));
        if (cancelled) return;
        if (!title) {
          setSummary(null);
          return;
        }
        let data = await fetchWikiSummary(lang, title);
        // 曖昧さ回避ページに当たった場合は、所在地が一致するリンク先に差し替える
        if (!cancelled && data.type === "disambiguation") {
          const resolvedTitle = await resolveDisambiguation(
            lang,
            title,
            spotName,
            region
          );
          if (resolvedTitle) data = await fetchWikiSummary(lang, resolvedTitle);
          else data = { ...data, extract: "" }; // 解決できなければ「見つからなかった」扱い
        }
        if (!cancelled) setSummary(data);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "情報の取得に失敗しました");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spotName, region, lang]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const imageSrc = summary?.originalimage?.source ?? summary?.thumbnail?.source;
  const articleUrl = summary?.content_urls?.desktop?.page;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="font-bold leading-tight">
              {summary?.title ?? spotName}
            </h2>
            <p className="text-xs text-gray-500">{region}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-full px-2 text-xl leading-none text-gray-400"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>

        {loading ? (
          <p className="py-6 text-center text-sm text-gray-500">
            Wikipediaから情報を取得中…
          </p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : !summary || !summary.extract ? (
          <p className="text-sm text-gray-500">
            Wikipediaに該当する記事が見つかりませんでした。
          </p>
        ) : (
          <>
            {imageSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageSrc}
                alt={summary.title}
                className="mb-3 max-h-72 w-full rounded-xl object-cover"
              />
            )}
            <p className="whitespace-pre-wrap text-sm text-gray-700">
              {summary.extract}
            </p>
            {articleUrl && (
              <a
                href={articleUrl}
                target="_blank"
                rel="noopener noreferrer"
                // iOSのPWAではtarget="_blank"がアプリ内ブラウザで開かれてしまうため、
                // iOSが解釈する`x-safari-https://`スキームで本物のSafariに切り替える
                // (それ以外の環境は通常のリンクのまま)
                onClick={(e) => {
                  if (isIosStandalone() && articleUrl.startsWith("https://")) {
                    e.preventDefault();
                    window.location.href = `x-safari-${articleUrl}`;
                  }
                }}
                className="mt-3 inline-block text-sm text-blue-600 underline"
              >
                Wikipediaで続きを読む ↗
              </a>
            )}
          </>
        )}

        <p className="mt-4 border-t border-gray-100 pt-2 text-xs text-gray-400">
          出典: Wikipedia(スポット名からの自動検索のため、同名の別の場所の
          情報が表示されることがあります)
        </p>
      </div>
    </div>
  );
}
