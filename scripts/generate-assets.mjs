/**
 * 產生品牌資源。
 *
 *   node scripts/generate-assets.mjs
 *
 * 輸出 favicon、PWA 圖示與社群分享圖到 public/。
 * 用程式產生而不是手工作圖，是為了改店名或主色時可以一鍵重新產出。
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import sharp from 'sharp';

const BRAND = '#E4572E';
const SURFACE = '#FFFBF7';
const INK = '#1C1917';

const out = 'public';
await mkdir(out, { recursive: true });

/** 麵碗圖示。跟 src/components/icons.tsx 的 IconBowl 同一個造型 */
function bowl(size, stroke, color) {
  const s = size / 24;
  return `
    <g transform="scale(${s})" fill="none" stroke="${color}"
       stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 11h18a9 9 0 0 1-9 9 9 9 0 0 1-9-9z"/>
      <path d="M8 8s-.5-1.5.5-3M12 8s-.5-1.5.5-3M16 8s-.5-1.5.5-3"/>
    </g>`;
}

// ---------------------------------------------------------------
// 圖示
// ---------------------------------------------------------------
async function icon(size, file, { bg = BRAND, fg = '#FFFFFF', radius } = {}) {
  const r = radius ?? size * 0.22;
  const inner = size * 0.62;
  const offset = (size - inner) / 2;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <rect width="${size}" height="${size}" rx="${r}" fill="${bg}"/>
    <g transform="translate(${offset} ${offset})">
      ${bowl(inner, 1.6, fg)}
    </g>
  </svg>`;

  await sharp(Buffer.from(svg)).png().toFile(`${out}/${file}`);
  console.log(`  ✓ ${file}  ${size}x${size}`);
}

console.log('\n[1] 圖示');
await icon(32, 'favicon-32.png', { radius: 6 });
await icon(180, 'apple-icon.png', { radius: 0 }); // iOS 會自己切圓角
await icon(192, 'icon-192.png');
await icon(512, 'icon-512.png');

// ---------------------------------------------------------------
// 社群分享圖
//
// 客人抽中大獎時分享到 LINE 或 IG，這張圖就是別人看到的第一眼。
// 尺寸 1200x630 是 Open Graph 的標準比例。
// ---------------------------------------------------------------
console.log('\n[2] 分享圖');

const ogSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${SURFACE}"/>
      <stop offset="100%" stop-color="#FDE5D5"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <rect width="1200" height="16" fill="${BRAND}"/>

  <g transform="translate(500 120)">
    ${bowl(200, 1.4, BRAND)}
  </g>

  <text x="600" y="410" font-size="76" font-weight="900" text-anchor="middle"
        fill="${INK}"
        font-family="'Noto Sans TC','PingFang TC','Hiragino Sans',sans-serif">
    消費就抽獎
  </text>
  <text x="600" y="490" font-size="40" text-anchor="middle" fill="#57534E"
        font-family="'Noto Sans TC','PingFang TC','Hiragino Sans',sans-serif">
    100% 中獎，回饋點數下次折抵
  </text>
  <text x="600" y="560" font-size="32" font-weight="700" text-anchor="middle"
        fill="${BRAND}"
        font-family="'Noto Sans TC','PingFang TC','Hiragino Sans',sans-serif">
    最大獎 免單
  </text>
</svg>`;

await sharp(Buffer.from(ogSvg)).png().toFile(`${out}/og.png`);
console.log('  ✓ og.png  1200x630');

// ---------------------------------------------------------------
// 清掉 create-next-app 留下的預設檔案
// ---------------------------------------------------------------
console.log('\n[3] 清理預設檔案');
for (const f of ['next.svg', 'vercel.svg', 'file.svg', 'globe.svg', 'window.svg']) {
  await rm(`${out}/${f}`, { force: true });
}
console.log('  ✓ 已移除 Next.js 範本圖檔');

// ---------------------------------------------------------------
// PWA manifest
//
// 客人可以把錢包頁加到主畫面，開起來像 app 一樣沒有網址列，
// 出示 QR 時畫面更乾淨。
// ---------------------------------------------------------------
console.log('\n[4] manifest');
await writeFile(
  `${out}/manifest.webmanifest`,
  JSON.stringify(
    {
      name: '消費抽獎',
      short_name: '抽獎',
      description: '來店消費即可抽獎，回饋點數累積折抵',
      start_url: '/wallet',
      display: 'standalone',
      background_color: SURFACE,
      theme_color: BRAND,
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        {
          src: '/icon-512.png',
          sizes: '512x512',
          type: 'image/png',
          purpose: 'any maskable',
        },
      ],
    },
    null,
    2,
  ),
);
console.log('  ✓ manifest.webmanifest');
console.log('\n完成。\n');
