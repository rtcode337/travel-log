// MapLibre GL JS 6のワーカースクリプトを public/maplibre-gl/ へコピーする。
// npm run dev / npm run build の前に自動実行される(package.jsonのpredev/prebuild)。
//
// maplibre-gl 6はワーカーのURLを自前で `new URL('./maplibre-gl-worker.mjs', import.meta.url)`
// として組み立てるが、webpack(Next.js)はバンドル時に `import.meta.url` を
// `file:///app/node_modules/...` へ置き換えてしまうため、http(s)で始まらないURLとして
// 弾かれて空文字になり、`new Worker("")` = ページ自身のHTMLをモジュールとして読み込む
// 事故になる(地図が一切描画されない)。実体を自前で配信してURLを明示的に教えることで回避する。
// 詳細と受け渡し先は lib/maplibre.ts のコメント参照。
//
// 生成物はgit管理しない(.gitignore)。バージョンを固定で持たずインストール済みの
// node_modulesから毎回コピーするため、maplibre-glを上げても中身がずれない。
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "maplibre-gl", "dist");
const dest = join(root, "public", "maplibre-gl");

// maplibre-gl-worker.mjs は `./maplibre-gl-shared.mjs` を相対importするため、
// 同じディレクトリに2つとも置く必要がある
const files = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

mkdirSync(dest, { recursive: true });
for (const file of files) {
  copyFileSync(join(src, file), join(dest, file));
}
console.log(`copied ${files.length} maplibre-gl worker files to public/maplibre-gl/`);
