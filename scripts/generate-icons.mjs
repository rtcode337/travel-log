// PWA・ファビコン用アイコンPNGの生成スクリプト。生成物はコミット済みのため
// 通常は実行不要。デザインを変える場合のみ、リポジトリルートで
//   npm i --no-save sharp && node scripts/generate-icons.mjs
// を実行して再生成する(sharpはdependenciesに含めない)。
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// 地図ピン(ティアドロップ)。viewBox 512x512の中央に置く前提
const pin = (fill, hole) => `
  <g>
    <path fill="${fill}" d="
      M 256 88
      C 185.3 88 136 145 136 216
      C 136 268 172 316 256 428
      C 340 316 376 268 376 216
      C 376 145 326.7 88 256 88
      Z"/>
    <circle cx="256" cy="214" r="52" fill="${hole}"/>
  </g>`;

const gradient = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3b82f6"/>
      <stop offset="1" stop-color="#1d4ed8"/>
    </linearGradient>
  </defs>`;

// 通常アイコン: 角丸背景(OS側で角丸マスクが適用されない場所向け)
const rounded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${gradient}
  <rect width="512" height="512" rx="106" fill="url(#bg)"/>
  ${pin("#ffffff", "#1d4ed8")}
</svg>`;

// 全面塗り: apple-touch-icon(iOS側が角丸を付ける)向け
const square = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${gradient}
  <rect width="512" height="512" fill="url(#bg)"/>
  ${pin("#ffffff", "#1d4ed8")}
</svg>`;

// maskable: 全面塗り+セーフゾーン(中央80%の円)に収まるようピンを縮小
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  ${gradient}
  <rect width="512" height="512" fill="url(#bg)"/>
  <g transform="translate(256 256) scale(0.78) translate(-256 -256)">
    ${pin("#ffffff", "#1d4ed8")}
  </g>
</svg>`;

const out = join(root, "public", "icons");
mkdirSync(out, { recursive: true });

const render = (svg, size, path) =>
  sharp(Buffer.from(svg)).resize(size, size).png().toFile(path);

await Promise.all([
  render(rounded, 192, join(out, "icon-192.png")),
  render(rounded, 512, join(out, "icon-512.png")),
  render(maskable, 512, join(out, "icon-maskable-512.png")),
  render(square, 180, join(root, "app", "apple-icon.png")),
  render(rounded, 128, join(root, "app", "icon.png")),
]);
console.log("done");
