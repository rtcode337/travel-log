/**
 * テキストをクリップボードへ写す。**成功したかどうかを返す**(呼び出し側が
 * 「コピーしました」を出すため)。
 *
 * `navigator.clipboard`はセキュアコンテキスト(https・localhost)でしか使えない。
 * このアプリはLANのIPへhttpで開くことがあり(PWAのサービスワーカーが登録
 * されないのと同じ条件)、そこでは`undefined`になるので、
 * 選択して`document.execCommand("copy")`する昔のやり方へ落とす。
 */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 権限を拒否された場合などは下のやり方を試す
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    // 画面に見えず、かつフォーカス時にスクロールしない位置へ置く
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    // 非推奨のAPIだが、非セキュアコンテキストで使える手段はこれだけ
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
