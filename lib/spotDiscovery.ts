import type { Rank } from "./rank";

/**
 * 周辺スポットのAI探索(`/api/spots/discover`)でサーバーと画面が共有する型と、
 * 候補をスポットに写すときの決まりごと。
 *
 * **探索の結果は保存しない。** 画面で選んで追加したものだけが通常のスポット
 * (`origin='manual'`)になり、還元用エクスポートにも乗る。候補の一覧は
 * 閉じれば消える(同じ場所をもう一度探せば取り直せる)。
 *
 * サーバー側の環境変数(`CHIEZO_BASE_URL`等)はここでは読まない ——
 * このモジュールはクライアントコンポーネントからも読む。
 */

/** 探索の半径(m)として選べる値。狭すぎると何も出ず、広すぎると中心と関係ない店が混ざる */
export const DISCOVERY_RADIUS_OPTIONS = [300, 500, 1000, 2000, 5000] as const;
/**
 * 既定は**いちばん狭い300m**。地図データ側は件数の上限を持たないので、
 * **半径がそのまま件数になる**(300mで約1,800件、1kmで約5,300件。実測)。
 * 広い側を既定にすると、開いた瞬間に読み切れない一覧が出る。足りなければ
 * 「もう一度探す」で広げるほうが、多すぎる中から絞るより早い
 */
export const DEFAULT_DISCOVERY_RADIUS = 300;

/** 検索語の長さの上限。プロンプトに埋めるので、長文を丸ごと渡させない */
export const MAX_DISCOVERY_QUERY_LENGTH = 100;

/**
 * 1回の探索で**AIに任せる件数**の選択肢と上限。2つの意味を兼ねる:
 * **精査させる地図データの件数**(中心から近い順にこの数だけ渡す)と、
 * **足させる候補の上限**。どちらも増やすほど答えが長くなって待ちが延びるので、
 * 1つのつまみにまとめてある。
 *
 * 上限30は外の制約ではなく、「1回の探索で待てる長さ」としてこちらで決めた値
 * (足りなければパネルの「もう一度探す」で同じ一覧に足せる)
 */
export const DISCOVERY_LIMIT_OPTIONS = [10, 20, 30] as const;
export const DEFAULT_DISCOVERY_LIMIT = 10;
export const MAX_DISCOVERY_CANDIDATES = 30;

/**
 * 件数の上限(`limit`)は**AIで探すときだけの都合**。返させる件数がそのまま
 * 待ち時間になるので選ばせている。
 *
 * **地図データはローカルのSQLiteを引くだけなので上限を持たない** —— 半径の中に
 * あるものは全部返す。件数を絞る意味は無く、絞ると「この辺に何があるか」を
 * 見るという地図データ側の使い方ができない。
 *
 * 代わりに**半径がそのまま件数を決める**。実測(新宿・既定のカテゴリ、2つの辞典の合計):
 * 300m=1,791件 / 500m=3,299件 / 1km=5,224件 / 2km=7,957件 / 5km=36,580件。
 * 印は地図レイヤーで描くので件数が増えても地図は動くが、**右のパネルの行は
 * 件数ぶん並ぶ**ので、広く取るほど一覧としては読みにくくなる。
 */
export const UNLIMITED_DISCOVERY_LIMIT = 0;

/**
 * 既存スポットと「同じもの」とみなす距離(m)。名前が一致しなくても、
 * この距離に既存スポットがあれば「登録済み」の印を付ける
 */
export const DISCOVERY_DUPLICATE_DISTANCE_M = 50;

/** 相手(chiezoの`/v1/ai/backends`の1件)。web検索を持つ相手だけが探索に使える */
export interface DiscoveryBackend {
  id: string;
  label: string;
  web: boolean;
  /** その相手で選べるモデル(空なら相手にモデルの概念が無い) */
  models: string[];
  /** その相手で選べるeffort(考える深さ。空なら指定できない) */
  efforts: string[];
}

/**
 * 探索の画面(`AiSpotDiscoverySearchModal`)が最初に読む状態。
 * **相手・モデル・深さは探索の画面で選ぶ**ので、その選択肢もここで配る
 */
export interface DiscoveryOptions {
  /** この種別・この環境・この権限で使えるか(falseならメニューにも出さない) */
  enabled: boolean;
  /** 選べる相手(web検索を持つものだけ)。chiezoに繋がらなければ空 */
  backends: DiscoveryBackend[];
  /** 何も選ばなかったときに使う相手 */
  defaultBackend: string;
  /** 何も選ばなかったときに使う深さ(相手が対応するときだけ効く) */
  defaultEffort: string;
  /** 選択肢を取れなかった理由(取れていればnull) */
  error: string | null;
}

/** 探索のときに画面から渡すAIの設定(未指定は既定に落ちる) */
export interface DiscoveryChoice {
  backend?: string | null;
  model?: string | null;
  effort?: string | null;
  /** 念の入れ方。未指定は`quick`(下の`DISCOVERY_DEPTHS`) */
  depth?: DiscoveryDepth | null;
}

/**
 * 候補の出どころ。**探し方は2段**で、既定は速いほう:
 * - `map`: 地図データ(chiezoのOverture Places辞典とOSM辞典)。**1秒かからず**、
 *   AIの枠も使わない。座標は地図データそのものなので正確。反面、説明文は持たない
 * - `ai`: web検索を持つAIに調べさせる。30秒〜2分かかるが、**地図データに無い新しい店**や
 *   一言の説明・参照URLが付く
 *
 * 「まず地図データで雑に集め、**その一覧をAIに精査させて足りないぶんを足す**」が
 * 想定の流れで、同じ一覧に混ぜて並ぶ(行に出どころの印が付く)
 */
export type DiscoverySource = "map" | "ai";

/**
 * AIに精査させる地図データの候補(POSTの`known`で渡す1件)。
 *
 * **渡すのは名前・ジャンル・距離だけ。** 座標や住所まで渡してもAIには使い道が無く、
 * プロンプトが伸びたぶんだけ待ちが延びる(位置は地図データのほうが正確なので、
 * AIに直させるものでもない)。
 */
export interface DiscoveryReviewTarget {
  name: string;
  genre: string | null;
  distance_m: number;
}

/**
 * 地図データの候補1件に対するAIの判定(`DiscoveryResult.reviews`)。
 *
 * **地図データは「在るもの」を全部並べるだけで、探しているものに合うかも、
 * 記録する価値があるかも見ていない**(半径300mで1,800件返ることもある)。
 * そこをAIに見せて選ばせ、あわせてジャンルとランクを付けさせる。
 * 選ばれなかった候補は画面がチェックを外して薄く出す(消しはしない ——
 * AIが見落とすこともあるので、選び直せる形で残す)。
 */
export interface DiscoveryReview {
  /**
   * 精査した候補の名前。**渡した名前をそのまま返す**(AIが書き写した名前ではない)
   * ので、画面は正規化した名前で行を突き合わせられる
   */
  name: string;
  /** 記録する価値があるとAIが見たか(falseなら画面はチェックを外す) */
  picked: boolean;
  /** AIが付けたランク(A〜E)。ランクを使う種別に聞いたときだけ入る */
  rank: Rank | null;
  /** AIが付け直したジャンル(地図データの分類が粗いことがある)。無ければnull */
  genre: string | null;
  /** AIによる一言。地図データは説明文を持たないので、ここで初めて付く */
  summary: string | null;
}

/**
 * 地図データの候補が**どの辞典から来たか**。
 *
 * **ライセンスが違うので候補ごとに持つ** —— OSMはODbL、OvertureはCDLA Permissive 2.0 で、
 * 説明文に書く出どころも変わる。1回の探索で両方の辞典を引いて混ぜるため、
 * 結果全体に1つ持たせる形では足りない。
 */
export type DiscoveryDataset = "osm" | "overture";

/** 説明文と画面に出す辞典の名前 */
export const DISCOVERY_DATASET_LABELS: Record<DiscoveryDataset, string> = {
  osm: "OpenStreetMap",
  overture: "Overture Maps",
};

/**
 * AIで探すときの念の入れ方。**既定は`quick`**。
 *
 * | | 頼み方 | 実測(antigravity+low、10件) |
 * |---|---|---|
 * | `quick` | webの検索を2回までに制限し、裏取りをさせない。URLは分かればでよい | **17秒** |
 * | `thorough` | 1件ずつweb検索で確かめさせ、根拠のURLを必須にする | 41秒 |
 *
 * **効くのは検索の回数**。エージェントとして動く相手は、放っておくと候補ごとに
 * 裏取りの検索を回して時間を使う(同じ問いで3分を超えることもあった)。
 * 上限を言い渡すだけで半分以下になり、**遅い側のばらつきも抑えられる**。
 */
export const DISCOVERY_DEPTHS = ["quick", "thorough"] as const;
export type DiscoveryDepth = (typeof DISCOVERY_DEPTHS)[number];
export const DEFAULT_DISCOVERY_DEPTH: DiscoveryDepth = "quick";

export const DISCOVERY_DEPTH_LABELS: Record<DiscoveryDepth, { label: string; note: string }> = {
  quick: { label: "さっくり", note: "15〜30秒" },
  thorough: { label: "しっかり", note: "40秒〜2分" },
};

/** AIが返した1件を、位置の確認と既存スポットとの突き合わせを済ませた形 */
export interface DiscoveryCandidate {
  name: string;
  name_kana: string | null;
  /** AIが答えた住所(都道府県から)。位置の確認に使い、画面にもそのまま出す */
  address: string | null;
  /** spots.regionに入れる地域(都道府県/州・県/国)。解決できなければnull(画面で選ばせる) */
  region: string | null;
  lat: number;
  lng: number;
  /** 業態・ジャンル(「ラーメン」「カフェ」など)。追加時はカテゴリに入れる */
  genre: string | null;
  /** AIによる一言の要約(口コミの転記ではなく、AI自身の言葉) */
  summary: string | null;
  /** AIが提案したランク(A〜E)。追加前にフォームで直せる */
  rank: Rank | null;
  rank_reason: string | null;
  /** 参照元のURL。無い候補は根拠が確かめられないので薄く出す */
  url: string | null;
  /**
   * 店名+住所の地名検索で中心から半径内に当たり、その座標に置き換えたらtrue。
   * falseのときの座標はAIの答えのままで「未確認」
   */
  location_verified: boolean;
  /** 中心からの距離(m)。半径の外に出た候補に気づけるように出す */
  distance_m: number;
  /**
   * どの地図データから来たか(`source: "map"`のときだけ。AIの候補はnull)。
   * **ライセンスが辞典ごとに違う**ので、説明文の出どころはこれで決める
   */
  dataset: DiscoveryDataset | null;
  /** 既存スポット(公開・承認待ち)と名前一致か近接していればその1件 */
  existing: { id: string; name: string } | null;
  /**
   * 地図データの候補にAIの精査が当たったか(`source: "map"`のときだけ立つ)。
   * **説明文の出どころに書く** —— ジャンル・要約がAIの言葉に置き換わっているので、
   * 地図データをそのまま写しただけの行と見分けられないと後から辿れない
   */
  ai_reviewed?: boolean;
}

/**
 * AIとの1往復の中身。**画面から見られるようにしてある** —— 何を頼んで何が返ったかが
 * 分からないと、遅い・少ない・的外れの原因を切り分けられない(プロンプトを直すのも、
 * 相手を替えるのも、この2つを見てから決める)。`source: "ai"`のときだけ入る
 */
export interface DiscoveryExchange {
  system: string;
  user: string;
  /** 相手が返した生の文字列(JSONを取り出す前) */
  response: string;
  /** 問い合わせにかかった時間(ミリ秒) */
  elapsed_ms: number;
}

export interface DiscoveryResult {
  candidates: DiscoveryCandidate[];
  /**
   * 渡した地図データの候補に対するAIの判定(`known`を渡したときだけ)。
   * **渡した順・渡した件数ぶん揃う**(選ばれなかったものも`picked: false`で入る) ——
   * 画面は「AIが見た上で選ばなかった」と「AIに渡していない」を区別する必要がある
   */
  reviews?: DiscoveryReview[];
  /** この結果の出どころ(行の印と、画面の言い回しに使う) */
  source: DiscoverySource;
  /** 実際に答えた相手とモデル(`ai`のときだけ。説明文には書かないが画面で確かめられる) */
  backend: string | null;
  model: string | null;
  /** 探索した日時(ISO 8601)。説明文の「AIがwebから収集(日付)」に使う */
  searched_at: string;
  /** 中心座標から引いた地域。候補側で地域が取れなかったときの既定 */
  center_region: string | null;
  /** AIとのやり取り(`source: "ai"`のときだけ)。画面の「やり取りを見る」で出す */
  exchange?: DiscoveryExchange;
}

/** `YYYY-MM-DD`(JST)。人が読む説明文に入れるので、実行環境のTZに依らせない */
export function formatJstDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())}`;
}

/**
 * 候補からスポットの説明文を組む。AIの要約のあとに、出どころ(AIがwebから収集した
 * 日付と参照URL)を必ず添える —— 手で書いた説明と見分けられるようにするため。
 * 口コミ本文や点数はプロンプトで転記を禁じているので、ここには入らない
 */
export function buildDiscoveredDescription(
  candidate: Pick<
    DiscoveryCandidate,
    "summary" | "url" | "location_verified" | "dataset" | "ai_reviewed"
  >,
  searchedAt: string,
  source: DiscoverySource
): string {
  const lines: string[] = [];
  if (candidate.summary?.trim()) lines.push(candidate.summary.trim());
  // **出どころは必ず添える** —— 手で書いた説明と見分けるため。
  // 地図データ由来のときは**どの辞典か**まで書く(ライセンスが辞典ごとに違うので、
  // 後から条件を確かめるには名前が要る)
  const provenance =
    source === "map"
      ? [
          `${DISCOVERY_DATASET_LABELS[candidate.dataset ?? "osm"]}から取得(${formatJstDate(searchedAt)})`,
        ]
      : [`AIがwebから収集(${formatJstDate(searchedAt)})`];
  // 地図データの行でも、ジャンル・要約はAIが付けていることがある(精査の段)。
  // **名前と座標は辞典のもの、言葉はAIのもの**という混ざり方をするので、そこを書き分ける
  if (source === "map" && candidate.ai_reviewed) provenance.push("ジャンルと要約はAIが精査");
  if (candidate.url) provenance.push(`参照: ${candidate.url}`);
  if (source === "ai" && !candidate.location_verified) provenance.push("位置は未確認");
  lines.push(provenance.join("、"));
  return lines.join("\n\n");
}

/** 2点間の距離(m)。半径内の判定と重複判定に使う(球面近似で十分) */
export function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** 名前の突き合わせ用に正規化する(全角半角・空白・記号の違いで別物にしない) */
/** 「〜本店」「〜新宿店」のような支店の名乗り(末尾のみ) */
const BRANCH_SUFFIX = /[^\s]{0,8}(本店|総本店|支店|店)$/;

/**
 * AIが答えた店名から、地図辞典を引くための問い合わせ語を**絞り込み順に**作る。
 *
 * **AIの店名は地図の見出しと一字一句は合わない。** 生の名前だけで引くと、
 * 実在する店を「確認できなかった」と扱ってしまう(実測: 10件中2件がこれで外れ、
 * `アカシア 新宿本店`が地図の`アカシア本店`に当たらなかった)。位置を確かめられないと
 * AIの座標がそのまま残るが、**当たった店ですら4〜70mずれていた**ので、
 * 外した候補は地図上の別の建物に立つ。
 *
 * 前のもので当たったら後ろは引かない(1つ緩めるごとに別の店を掴む危険が上がるため)。
 */
export function mapLookupQueries(name: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const v = value.trim();
    if (v.length >= 2 && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  };
  add(name);
  // 括弧の中(英字の別名・読み)を落とす: `ベルク (BERG)` → `ベルク`
  const bare = name.replace(/[((][^))]*[))]/g, " ").trim();
  add(bare);
  // 支店の名乗りを落とす: `アカシア 新宿本店` → `アカシア`
  add(bare.replace(BRANCH_SUFFIX, "").trim());
  // 空白で切ったうちいちばん長い語(`ハンバーグ ウィル` → `ハンバーグ`)
  const parts = bare.split(/\s+/).filter((p) => p.length >= 2);
  if (parts.length > 1) add(parts.reduce((a, b) => (b.length > a.length ? b : a)));
  return out.slice(0, 4);
}

/**
 * 地図辞典の見出しが、AIの答えた店名と**同じ店を指していると見てよいか**。
 *
 * 問い合わせ語を緩めるほど別の店を掴みやすくなるので歯止めが要る
 * (`中村屋`で引くと`中村屋サロン美術館`も当たる)。正規化した名前が
 * どちらかを含んでいることを条件にする —— 地図側は`天ぷら新宿つな八総本店`のように
 * 業種や地名を前に付けることがあるので、**完全一致では狭すぎる**。
 */
export function looksLikeSameSpot(aiName: string, mapTitle: string): boolean {
  const key = normalizeSpotName(
    aiName.replace(/[((][^))]*[))]/g, " ").trim().replace(BRANCH_SUFFIX, "").trim()
  ) || normalizeSpotName(aiName);
  // 地図側の `名前 (連番)` `名前 (node:123)` は弁別のための後付けなので外す
  // 地図側の弁別のための後付け(`名前 (node:123)` `名前 (2077482)`)を外す
  const title = normalizeSpotName(
    mapTitle.replace(/\s*\((?:node|way|relation):\d+\)$/, "").replace(/\s*\(\d+\)$/, "")
  );
  if (!key || !title) return false;
  // **含み合うことしか認めない。** ここを緩めると、緩めた問い合わせ語で引いた
  // 別の店(`ハンバーグ ウィル`で`レジデンスホテルウィル新宿`)を掴む。
  // 掴んだら座標もURLも黙って別の店のものに置き換わるので、**取りこぼすより悪い**
  return title.includes(key) || key.includes(title);
}

export function normalizeSpotName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　・･\-‐‑–—―~〜()()[\]【】「」『』]/g, "");
}
