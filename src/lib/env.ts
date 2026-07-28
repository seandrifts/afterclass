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

export const env = {
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',

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
