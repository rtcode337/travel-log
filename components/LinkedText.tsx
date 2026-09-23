import { Fragment, type ReactNode } from "react";
import WikipediaIcon from "@/components/WikipediaIcon";

/**
 * 本文中のURLを拾う。終端の判定が要点で、日本語の文章に埋め込まれたURLは
 * 空白で区切られないため「URLに使えない字が出たら終わり」で切る。
 * 丸括弧を除いているのは、出典の注記のようにURLを括弧でくくって書くことが
 * 多く、閉じ括弧までURLに含めると行き先が404になるため
 * (travel-log-data側は、記事名に含まれる丸括弧をパーセントエンコードして
 * この規則で切れるURLだけを書いている)。日本語の句読点・鉤括弧・全角括弧も
 * 同じ理由で外す
 */
const URL_RE = /https?:\/\/[^\s()（）「」『』、。，．]+/g;

/**
 * Wikipediaの記事リンクの書き方。`[ja.wikipedia:汽車道]`のように
 * **言語版と記事名だけ**を本文に書き、URLはこちらで組む。
 *
 * **本文を解釈して出どころを組み直さない**ための決まり。かつては
 * `(出典: ja.wikipedia「◯◯」 https://…)`という日本語の文を表示側で切り分けて
 * リンクに直していたが、書き方が少し変わるだけで壊れるうえ、データを見ても
 * 何がリンクになるのか分からなかった。**リンクになるものはデータ側に書く。**
 *
 * 記事名は`]`まで。丸括弧付きの記事名(「ハーバー (菓子)」)もそのまま書ける
 * ——URLのパーセントエンコードはこちらで行うため。
 */
const WIKI_RE = /\[([a-z-]{2,10})\.wikipedia:([^\]\n]+)\]/g;

// 末尾に付きやすい記号を落とす(「…参照。」の句点は上で外れるが、
// 半角の . , ; : は URL 自体にも現れるため、末尾のときだけ落とす)
function trimTail(url: string): { url: string; tail: string } {
  const m = url.match(/[.,;:!?]+$/);
  if (!m) return { url, tail: "" };
  return { url: url.slice(0, -m[0].length), tail: m[0] };
}

/**
 * テキスト中のURLと`[ja.wikipedia:記事名]`をリンクにして描く。スポット・ルート・
 * 訪問予定リストの説明文に使う —— travel-log-data由来の説明文には出どころの
 * 記事が入っており、素のテキストのままだと押せないため。
 *
 * Wikipediaの記事はURLではなく**アイコン+記事名**で出す。URLは読むものではなく、
 * 日本語の文の中に生のURLが並ぶと本文が読みにくくなる。
 *
 * dangerouslySetInnerHTMLは使わない(説明文は管理画面から誰でも書けるので、
 * HTMLとして解釈させるとそこがXSSの口になる)。href に入れるのも
 * http/https で始まるものと、上の書き方から組み立てたWikipediaのURLだけで、
 * javascript: は正規表現の時点で拾わない
 */
export default function LinkedText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  // 2つの書き方を出現順に処理する(別々に回すと位置がずれる)
  const matches = [...text.matchAll(URL_RE), ...text.matchAll(WIKI_RE)].sort(
    (a, b) => (a.index ?? 0) - (b.index ?? 0)
  );
  for (const m of matches) {
    const start = m.index ?? 0;
    if (start < last) continue; // 重なった分(URLを含む記事名など)は先勝ち
    if (start > last) parts.push(text.slice(last, start));
    if (m[0].startsWith("[")) {
      const [, lang, title] = m;
      parts.push(
        <a
          key={`${start}-${title}`}
          href={`https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-baseline gap-1 text-blue-600 underline"
        >
          <WikipediaIcon className="size-3.5 self-center" />
          {title}
        </a>
      );
      last = start + m[0].length;
      continue;
    }
    const { url, tail } = trimTail(m[0]);
    if (!url) continue;
    parts.push(
      <a
        key={`${start}-${url}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="break-all text-blue-600 underline"
      >
        {url}
      </a>
    );
    if (tail) parts.push(tail);
    last = start + m[0].length;
  }
  if (last === 0) return <>{text}</>;
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </>
  );
}
