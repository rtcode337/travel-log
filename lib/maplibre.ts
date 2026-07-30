// MapLibre GL JSの共通入口。地図を作るコンポーネント(MapView・MiniMap・
// SpotRepositionModal)は "maplibre-gl" を直接importせず、必ずこのモジュールを経由する。
//
// maplibre-gl 6は、ワーカーのURLを指定しない場合 `import.meta.url`(自分自身のモジュールURL)を
// 起点に `./maplibre-gl-worker.mjs` を解決する実装になった(node_modules/maplibre-gl/
// src/util/web_worker.ts の defaultWorkerUrl)。ところがwebpack(next.config.tsの理由により
// dev/buildとも --webpack)はバンドル時に `import.meta.url` を
// `"file:///app/node_modules/maplibre-gl/dist/maplibre-gl.mjs"` という文字列へ置き換えるため、
// http(s)で始まらないURLとして弾かれて空文字が返り、`new Worker("", { type: "module" })` =
// **ページ自身のHTMLをJSモジュールとして読み込む**という動作になる。ブラウザは
// 「Failed to load module script: ... non-JavaScript MIME type of "text/html"」で拒否し、
// ワーカーが起動しないためタイルもスポットのピンも一切描画されない。
//
// そこでワーカーの実体を public/maplibre-gl/ へコピーして(scripts/copy-maplibre-worker.mjs、
// npm run dev / build の前に自動実行)自前で配信し、そのURLを setWorkerUrl で明示的に渡す。
// 同一オリジンのモジュールワーカーとしてそのまま起動する(maplibre側のBlob経由の
// クロスオリジン対策には乗らない)。
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/** public/maplibre-gl/ に配信するワーカーのパス(proxy.tsの認証ガードからも除外している) */
const WORKER_URL = "/maplibre-gl/maplibre-gl-worker.mjs";

if (typeof window !== "undefined" && !maplibregl.getWorkerUrl()) {
  maplibregl.setWorkerUrl(WORKER_URL);
}

export * from "maplibre-gl";
