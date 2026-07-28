/**
 * 建立官方帳號的圖文選單。
 *
 *   node --env-file=.env.local scripts/setup-richmenu.mjs
 *
 * 在聊天室下方放一排常駐按鈕，客人隨時點得到自己的點數。
 * 這完全不消耗訊息額度，是免費方案下最划算的功能。
 *
 * 重複執行是安全的：會先刪掉同名的舊選單再建新的。
 */
import sharp from 'sharp';

const token = process.env.LINE_MESSAGING_TOKEN;
const siteUrl = (process.env.SITE_URL ?? '').replace(/\/$/, '');

if (!token) {
  console.error('缺少 LINE_MESSAGING_TOKEN');
  process.exit(1);
}
if (!siteUrl) {
  console.error('缺少 SITE_URL');
  process.exit(1);
}

/**
 * 擋掉本機網址。
 *
 * 圖文選單是推給所有真實好友看的，按鈕連到 localhost 的話客人點了
 * 只會得到一個開不起來的頁面，而且要等有人回報才會發現。
 *
 * .env.local 裡的 SITE_URL 本來就是本機開發用的，所以這個腳本
 * 一定要明確指定正式網址再跑。
 */
if (/localhost|127\.0\.0\.1|^http:\/\//.test(siteUrl)) {
  console.error(`\n拒絕執行：SITE_URL 是「${siteUrl}」`);
  console.error('圖文選單會推給所有真實好友，按鈕必須指向正式網址。\n');
  console.error('請這樣跑：');
  console.error(
    '  SITE_URL=https://你的正式網址 node --env-file=.env.local scripts/setup-richmenu.mjs\n',
  );
  process.exit(1);
}

const NAME = 'lucky-draw-main';

// 2500x843 是 LINE 的「小尺寸」規格，三等分剛好放三顆按鈕。
// 用大尺寸（2500x1686）會佔掉半個手機畫面，聊天內容被擠掉太多。
const W = 2500;
const H = 843;
const COL = Math.floor(W / 3);

const BUTTONS = [
  { emoji: '💰', label: '我的點數', uri: `${siteUrl}/wallet` },
  { emoji: '🧾', label: '點數明細', uri: `${siteUrl}/wallet/history` },
  { emoji: '📋', label: '活動辦法', uri: `${siteUrl}/rules` },
];

const api = (path, options = {}) =>
  fetch(`https://api.line.me${path}`, {
    ...options,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });

// ---------------------------------------------------------------
// 產生選單圖
// ---------------------------------------------------------------
function buildSvg() {
  const cells = BUTTONS.map((b, i) => {
    const cx = COL * i + COL / 2;
    const divider =
      i < BUTTONS.length - 1
        ? `<line x1="${COL * (i + 1)}" y1="140" x2="${COL * (i + 1)}" y2="${H - 140}"
             stroke="#EADFD5" stroke-width="4" />`
        : '';
    return `
      <text x="${cx}" y="${H / 2 - 40}" font-size="150" text-anchor="middle">${b.emoji}</text>
      <text x="${cx}" y="${H / 2 + 130}" font-size="88" font-weight="700"
            text-anchor="middle" fill="#1C1917"
            font-family="'Noto Sans TC','PingFang TC','Hiragino Sans',sans-serif">${b.label}</text>
      ${divider}`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="${W}" height="${H}" fill="#FFFBF7"/>
    <rect width="${W}" height="12" fill="#E4572E"/>
    ${cells}
  </svg>`;
}

console.log('\n[1] 產生選單圖');
const png = await sharp(Buffer.from(buildSvg())).png().toBuffer();
console.log(`  ✓ ${W}x${H}，${Math.round(png.length / 1024)} KB`);

// ---------------------------------------------------------------
// 清掉舊的同名選單
// ---------------------------------------------------------------
console.log('\n[2] 清理舊選單');
const listRes = await api('/v2/bot/richmenu/list');
const list = listRes.ok ? (await listRes.json()).richmenus ?? [] : [];

let removed = 0;
for (const menu of list) {
  if (menu.name === NAME) {
    await api(`/v2/bot/richmenu/${menu.richMenuId}`, { method: 'DELETE' });
    removed += 1;
  }
}
console.log(removed > 0 ? `  ✓ 移除 ${removed} 個舊選單` : '  ✓ 沒有舊選單');

// ---------------------------------------------------------------
// 建立選單
// ---------------------------------------------------------------
console.log('\n[3] 建立選單');
const createRes = await api('/v2/bot/richmenu', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    size: { width: W, height: H },
    selected: true,
    name: NAME,
    chatBarText: '我的點數',
    areas: BUTTONS.map((b, i) => ({
      bounds: { x: COL * i, y: 0, width: COL, height: H },
      action: { type: 'uri', label: b.label, uri: b.uri },
    })),
  }),
});

if (!createRes.ok) {
  console.error('  ✗ 建立失敗：', await createRes.text());
  process.exit(1);
}

const { richMenuId } = await createRes.json();
console.log(`  ✓ ${richMenuId}`);

// ---------------------------------------------------------------
// 上傳圖片並設為預設
// ---------------------------------------------------------------
console.log('\n[4] 上傳圖片');
const uploadRes = await fetch(
  `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
  {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'image/png' },
    body: png,
  },
);

if (!uploadRes.ok) {
  console.error('  ✗ 上傳失敗：', await uploadRes.text());
  process.exit(1);
}
console.log('  ✓ 完成');

console.log('\n[5] 設為所有好友的預設選單');
const defaultRes = await api(`/v2/bot/user/all/richmenu/${richMenuId}`, {
  method: 'POST',
});

if (!defaultRes.ok) {
  console.error('  ✗ 設定失敗：', await defaultRes.text());
  process.exit(1);
}
console.log('  ✓ 完成');

console.log('\n選單已上線。到 LINE 聊天室下拉即可看到，可能要幾分鐘才會更新。');
console.log('按鈕連向：');
for (const b of BUTTONS) console.log(`  ${b.label} → ${b.uri}`);
console.log('');
