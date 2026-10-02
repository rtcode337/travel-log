/**
 * システムが記録した日時(作成日時・ダウンロード日時など)を**日本時間(JST)で**見せるための書式。
 *
 * 保存・比較はUTCのまま、人に見せる直前にここで変換する。**実行環境のTZに依らせない** ——
 * `toLocaleString`は端末やサーバーのTZで変わり、手元では正しく見えるぶん気づけない。
 * JSTは夏時間を持たないので固定オフセット(+09:00)で足り、tzdataも要らない。
 *
 * **訪問日時(`visits.visited_on`)はここを通さない。** あれは`datetime-local`で入力した
 * 端末のローカル時刻で、表示も入力と同じ扱いにそろえている(`formatVisitedOn`)。
 */

const JST_OFFSET_MS = 9 * 3600_000;

/** JSTに寄せた年月日・時分(`getUTC*`で読む) */
function jstParts(value: string | number | Date) {
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return null;
  const d = new Date(t + JST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    d: d.getUTCDate(),
    hh: String(d.getUTCHours()).padStart(2, "0"),
    mm: String(d.getUTCMinutes()).padStart(2, "0"),
  };
}

/** `2026/10/2 09:05`。読めない値は空文字 */
export function formatJstDateTime(value: string | number | Date): string {
  const p = jstParts(value);
  return p ? `${p.y}/${p.m}/${p.d} ${p.hh}:${p.mm}` : "";
}

/** `2026/10/2`。読めない値は空文字 */
export function formatJstDate(value: string | number | Date): string {
  const p = jstParts(value);
  return p ? `${p.y}/${p.m}/${p.d}` : "";
}

/** ファイル名などに使う`20261002`(JSTの日付) */
export function jstDateStamp(value: string | number | Date = Date.now()): string {
  const p = jstParts(value);
  if (!p) return "";
  return `${p.y}${String(p.m).padStart(2, "0")}${String(p.d).padStart(2, "0")}`;
}
