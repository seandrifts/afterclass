/**
 * 自訂網域切換的驗收。
 *
 *   node scripts/check-domain.mjs afterclass.party
 *
 * 換網域最容易漏掉的不是 DNS，是 LINE 那邊的 Callback URL 與 Vercel
 * 的 SITE_URL。這兩個沒同步的話網站看起來一切正常，只有客人按下
 * 「用 LINE 登入」才會爆，而且是在店門口爆。
 *
 * 所以這裡不只看網站通不通，而是實際跟著 LINE 的登入導向走一遍，
 * 把 redirect_uri 抓出來比對。
 */
const domain = (process.argv[2] ?? '').replace(/^https?:\/\//, '').replace(/\/$/, '');
if (!domain) {
  console.error('用法：node scripts/check-domain.mjs afterclass.party');
  process.exit(1);
}

const base = `https://${domain}`;
const OLD = 'https://afterclass-psi.vercel.app';

let failed = 0;
const ok = (l, d = '') => console.log(`  ✓ ${l}${d ? `  ${d}` : ''}`);
const bad = (l, hint) => {
  failed++;
  console.log(`  ✗ ${l}`);
  if (hint) console.log(`     → ${hint}`);
};

console.log(`\n驗收 ${base}\n`);

console.log('[1] 網域與憑證');
try {
  const res = await fetch(`${base}/login`, { redirect: 'manual' });
  if (res.status === 200) ok('HTTPS 正常', `HTTP ${res.status}`);
  else bad(`回應是 HTTP ${res.status}`, 'Vercel 的網域可能還在驗證中，等幾分鐘再試');
} catch (e) {
  bad(`連不上：${e.message}`, 'DNS 還沒生效，或 Vercel 尚未加入這個網域');
  console.log('');
  process.exit(1);
}

console.log('\n[2] SITE_URL 有沒有改');
{
  const html = await fetch(`${base}/login`).then((r) => r.text());
  const og = html.match(/property="og:image" content="([^"]+)"/)?.[1] ?? '';

  if (og.includes(domain)) {
    ok('分享預覽指向新網域', og);
  } else {
    bad(
      `分享預覽還是舊網址：${og || '(讀不到)'}`,
      'Vercel → Settings → Environment Variables，把 SITE_URL 改成 ' +
        base +
        '，然後重新部署一次（改環境變數不會自動重建）',
    );
  }
}

console.log('\n[3] LINE 登入的 redirect_uri');
{
  const res = await fetch(`${base}/auth/line`, { redirect: 'manual' });
  const location = res.headers.get('location') ?? '';

  if (!location.includes('line.me')) {
    bad('沒有導向 LINE', `拿到的是：${location.slice(0, 80) || res.status}`);
  } else {
    const redirectUri = new URL(location).searchParams.get('redirect_uri') ?? '';
    if (redirectUri.startsWith(base)) {
      ok('redirect_uri 用新網域', redirectUri);
      console.log(
        `     LINE Developers 的 Callback URL 必須**完全**是這一行，多一個斜線都不行`,
      );
    } else {
      bad(
        `redirect_uri 還是舊的：${redirectUri}`,
        'SITE_URL 沒生效，同上一項',
      );
    }
  }
}

console.log('\n[4] 舊網址還通不通（已印出去的紙卡靠這個）');
try {
  const res = await fetch(`${OLD}/login`, { redirect: 'manual' });
  if (res.status === 200) {
    ok('舊網址仍可存取', '已印的 100 張卡不會失效');
  } else {
    bad(
      `舊網址回 HTTP ${res.status}`,
      '已經印出去的紙卡會掃不到。Vercel 預設會保留 .vercel.app，除非手動關掉',
    );
  }
} catch {
  bad('舊網址連不上', '已印的紙卡會失效');
}

console.log(
  failed === 0
    ? '\n全部通過。可以把新網址印成櫃檯的加入會員 QR 了。\n'
    : `\n有 ${failed} 項要處理。\n`,
);
process.exit(failed === 0 ? 0 : 1);
