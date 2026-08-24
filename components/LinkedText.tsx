import { Fragment, type ReactNode } from "react";

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

// 末尾に付きやすい記号を落とす(「…参照。」の句点は上で外れるが、
// 半角の . , ; : は URL 自体にも現れるため、末尾のときだけ落とす)
function trimTail(url: string): { url: string; tail: string } {
  const m = url.match(/[.,;:!?]+$/);
  if (!m) return { url, tail: "" };
  return { url: url.slice(0, -m[0].length), tail: m[0] };
}

/**
 * テキスト中のURLをリンクにして描く。スポット・ルート・訪問予定リストの
 * 説明文に使う —— travel-log-data由来の説明文には出典のWikipedia URLが
 * 入っており、素のテキストのままだと押せないため。
 *
 * dangerouslySetInnerHTMLは使わない(説明文は管理画面から誰でも書けるので、
 * HTMLとして解釈させるとそこがXSSの口になる)。href に入れるのも
 * http/https で始まるものだけで、javascript: は正規表現の時点で拾わない
 */
export default function LinkedText({ text }: { text: string }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const start = m.index ?? 0;
    const { url, tail } = trimTail(m[0]);
    if (!url) continue;
    if (start > last) parts.push(text.slice(last, start));
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
