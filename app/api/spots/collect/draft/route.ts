import { NextResponse } from "next/server";
import {
  draftExtract,
  draftPrompt,
  findCollection,
  resolveCollectContext,
} from "@/lib/spotCollectServer";

/**
 * 抽出条件・プロンプトをAIに書かせる(spot_admin/admin専用)。**保存はしない**。
 *
 * **集めたい軸は種別ごとに違う**(ラーメン店・神社・駅・道の駅…)ので、どのソースの
 * どのタグを引くかも、どう調べさせるかも決め打ちにできない。ふつうの言葉で書いた
 * 依頼文をchiezoへ渡し、返ってきた案を画面で確かめてから依頼する。
 *
 * **2つに分けてあるのは、1回ずつ待たせるため。** どちらもAIが1回動くので
 * 十数秒〜数分かかる。まとめて走らせると待ち時間が積み上がるうえ、
 * **抽出条件が決まってから書いたプロンプトのほうが良くなる**(どの辞典から
 * 引いた名簿を精査するのかを、依頼文に書けるようになる)。
 *
 * | `kind` | 呼ぶ先 | 返るもの |
 * |---|---|---|
 * | `extract` | `/v1/collect/draft-extract` | 抽出条件と、**その場で引いた件数・先頭数件** |
 * | `prompt` | `/v1/collect/draft` | 巡回のプロンプト |
 *
 * 抽出条件のほうに件数が付くのが要 —— **タグは完全一致でしか引けない**ので、
 * それらしい名前を書かれると静かな0件になる。0件のときchiezoは実在するタグ名を
 * 候補として返すので、画面はそれを出して依頼文を書き直させる。
 */
export async function POST(request: Request) {
  const ctx = await resolveCollectContext(request);
  if ("error" in ctx) return ctx.error;
  const { baseUrl, source } = ctx;

  const body = await request.json().catch(() => null);
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const want = text(body?.want);
  if (!want) {
    return NextResponse.json({ error: "依頼文を入力してください。" }, { status: 400 });
  }
  // **既にある収集にだけ名前を渡す。** 向こうは名前で相手・モデルと現在の指定を
  // 引くので、まだ無い名前を渡すと404で断られる
  const name = (await findCollection(baseUrl, source)) ? source : undefined;

  const kind = new URL(request.url).searchParams.get("kind") ?? "prompt";
  const { data, error } =
    kind === "extract"
      ? await draftExtract(baseUrl, {
          want,
          name,
          backend: text(body?.backend),
          model: text(body?.model),
          effort: text(body?.effort),
        })
      : await draftPrompt(baseUrl, {
          want,
          name,
          current: text(body?.current),
          feedback: text(body?.feedback),
        });
  if (error) return NextResponse.json({ error }, { status: 502 });
  return NextResponse.json({ data });
}
