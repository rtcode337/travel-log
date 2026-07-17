"use client";

import { useEffect, useState } from "react";

/**
 * Wikipedia(ja)のREST API(page/summary)のレスポンスのうち、表示に使う部分。
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

/** タイトル比較用に番地・記号類を除いたコア文字列を作る */
function coreOf(name: string): string {
  return name.replace(/[0-9０-９]+番館?|[・･、,()（）\s　]/g, "");
}

/**
 * MediaWiki Action APIでスポット名だけを検索する。所在地(都道府県・市区町村)を
 * クエリに混ぜると、スポット自体の記事が無い場合に市区町村や「〇〇県出身の人物一覧」
 * のような無関係な記事が上位に来やすいため、名前単体で検索したうえで、上位数件の中から
 * タイトルにスポット名が含まれるものだけを採用する(同名の別記事の誤爆を避ける)
 */
async function searchWikiTitle(spotName: string): Promise<string | null> {
  const url =
    "https://ja.wikipedia.org/w/api.php?action=query&list=search&format=json&origin=*" +
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

async function fetchWikiSummary(title: string): Promise<WikiSummary> {
  const res = await fetch(
    `https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      title.replace(/ /g, "_")
    )}`
  );
  if (!res.ok) throw new Error(`記事の取得に失敗しました (${res.status})`);
  return (await res.json()) as WikiSummary;
}

/**
 * 曖昧さ回避ページのリンク先から、スポット名を含みかつ所在地(市区町村→都道府県の順)
 * も一致するタイトルを選ぶ(曖昧さ回避ページは大抵「〇〇 (△△市)」のように所在地を
 * 括弧書きしたリンクを列挙しているが、市区町村名単体へのリンクも別途混ざっているため、
 * スポット名を含まないリンク=「伊勢原市」のような市区町村ページ自体は候補から除く)
 */
async function resolveDisambiguation(
  disambigTitle: string,
  spotName: string,
  prefecture: string,
  municipality: string | null
): Promise<string | null> {
  const url =
    "https://ja.wikipedia.org/w/api.php?action=query&prop=links&pllimit=500&plnamespace=0&format=json&formatversion=2&origin=*&titles=" +
    encodeURIComponent(disambigTitle);
  const res = await fetch(url);
  if (!res.ok) return null;
  const json = (await res.json()) as WikiLinksResponse;
  const core = coreOf(spotName);
  const candidates = json.query?.pages?.[0]?.links?.filter((l) =>
    coreOf(l.title).includes(core)
  ) ?? [];
  const byMunicipality =
    municipality && candidates.find((l) => l.title.includes(municipality));
  const byPrefecture = candidates.find((l) => l.title.includes(prefecture));
  return (byMunicipality || byPrefecture || candidates[0])?.title ?? null;
}

/**
 * スポット名+所在地からWikipedia(ja)の記事を検索し、代表画像と概要をモーダルで表示する。
 * 名前による自動検索のため、同名の別の場所がヒットする可能性がある点は画面上でも注記する。
 */
export default function SpotInfoModal({
  spotName,
  prefecture,
  municipality,
  onClose,
}: {
  spotName: string;
  prefecture: string;
  municipality: string | null;
  onClose: () => void;
}) {
  const [summary, setSummary] = useState<WikiSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const title = await searchWikiTitle(spotName);
        if (cancelled) return;
        if (!title) {
          setSummary(null);
          return;
        }
        let data = await fetchWikiSummary(title);
        // 曖昧さ回避ページに当たった場合は、所在地が一致するリンク先に差し替える
        if (!cancelled && data.type === "disambiguation") {
          const resolvedTitle = await resolveDisambiguation(
            title,
            spotName,
            prefecture,
            municipality
          );
          if (resolvedTitle) data = await fetchWikiSummary(resolvedTitle);
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
  }, [spotName, prefecture, municipality]);

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
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h2 className="font-bold leading-tight">
              {summary?.title ?? spotName}
            </h2>
            <p className="text-xs text-gray-500">
              {prefecture}
              {municipality && ` ${municipality}`}
            </p>
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
