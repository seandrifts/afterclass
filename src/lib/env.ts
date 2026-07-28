import 'server-only';

/**
 * 集中讀取並驗證環境變數。
 * 缺變數要在啟動時就爆掉，不要等到使用者按下抽獎才發現。
 */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `缺少環境變數 ${name}。請參考 .env.example 建立 .env.local。`,
    );
  }
  return value;
}

/**
 * 站台網址。
 *
 * 這個值決定 QR Code 掃出來會連到哪裡，以及 LINE 登入完成後轉回哪裡。
 * 填錯的話印出去的整批卡片都會作廢，所以做了三層保險：
 *
 *   1. SITE_URL          手動指定，之後綁自訂網域時用這個
 *   2. Vercel 自動提供的正式網域，沒設定 SITE_URL 時自動帶入
 *   3. 本機開發預設值
 *
 * 刻意不用 NEXT_PUBLIC_ 前綴。那個前綴的變數會在建置時被寫死進程式碼，
 * 改值必須重新部署；這裡全部都是伺服器端在用，用一般變數就能即時生效。
 */
function resolveSiteUrl(): string {
  const explicit = process.env.SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, '')}`;

  return 'http://localhost:3100';
}

export const env = {
  siteUrl: resolveSiteUrl(),

  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseServiceKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),

  lineChannelId: () => required('LINE_CHANNEL_ID'),
  lineChannelSecret: () => required('LINE_CHANNEL_SECRET'),

  sessionSecret: () => {
    const secret = required('SESSION_SECRET');
    if (secret.length < 32) {
      throw new Error('SESSION_SECRET 至少需要 32 字元');
    }
    return secret;
  },

  cronSecret: () => required('CRON_SECRET'),
};
