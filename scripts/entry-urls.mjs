/*
  印出老闆與店員的登入入口。

    node --env-file=.env.local scripts/entry-urls.mjs

  店員入口在沒有設定 STAFF_ENTRY_KEY 時是從 SESSION_SECRET 推導的，
  推導方式必須跟 src/lib/entry.ts 的 staffEntryKey() 完全一致。

  這兩個網址等同鑰匙，不要貼到公開的地方。
*/
import { createHmac } from 'node:crypto';

const site = (process.env.SITE_URL_OVERRIDE ?? 'https://afterclass.party').replace(/\/$/, '');

const admin = process.env.ADMIN_ENTRY_KEY?.trim();
const staff =
  process.env.STAFF_ENTRY_KEY?.trim() ||
  (process.env.SESSION_SECRET
    ? createHmac('sha256', process.env.SESSION_SECRET)
        .update('staff-entry-v1')
        .digest('hex')
        .slice(0, 24)
    : null);

console.log(`老闆  ${admin ? `${site}/enter/${admin}` : '（沒有設定 ADMIN_ENTRY_KEY）'}`);
console.log(`店員  ${staff ? `${site}/enter/${staff}` : '（沒有設定 SESSION_SECRET）'}`);
