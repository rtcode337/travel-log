/**
 * 最後に開いていたスポット種別のキーを覚えておくCookie。
 * proxy.tsがログイン済みユーザーの/[type]/(map|spots|account|admin)への
 * アクセス時に書き込み、ルート`/`(app/page.tsx)がリダイレクト先の決定時に
 * app_settings.active_spot_type_id(管理画面で設定する既定)より優先して参照する。
 * 種別の存在・閲覧可否の検証は書き込み時ではなく読み取り時に行う
 * (全ルートを通るproxyにDBアクセスを持ち込まないため)。
 */
export const LAST_SPOT_TYPE_COOKIE = "last_spot_type";

export const LAST_SPOT_TYPE_MAX_AGE = 60 * 60 * 24 * 365; // 1年

/**
 * URLの[type]セグメントからスポット種別キーを取り出すパターン。
 * キーは機械可読な英数字+アンダースコア(travel-log-data/CLAUDE.md参照)で、
 * 対象外のパス(/login等)をCookieに書き込まないためのフィルタも兼ねる。
 */
export const SPOT_TYPE_PATH_PATTERN =
  /^\/([A-Za-z0-9_]+)\/(?:map|spots|account|admin)$/;
