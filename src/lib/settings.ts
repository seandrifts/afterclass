import 'server-only';

import { cache } from 'react';

import { db } from './supabase';
import type { Settings } from './types';

/**
 * 讀取全域設定。
 *
 * 用 React 的 cache() 做「同一個請求內只查一次」的去重，
 * 不做跨請求快取。
 *
 * 理由是這個規模的流量根本不需要，而跨請求快取會帶來
 * 「後台改了但沒生效」的困惑。設定就該是改完立刻生效，
 * 為了省幾次資料庫查詢而讓老闆懷疑後台壞掉並不划算。
 */
export const getSettings = cache(async (): Promise<Settings> => {
  const { data, error } = await db()
    .from('settings')
    .select('*')
    .eq('id', 1)
    .single();

  if (error || !data) {
    throw new Error(`讀取 settings 失敗：${error?.message ?? '找不到設定'}`);
  }

  return data as Settings;
});

/**
 * 活動目前是否開放抽獎。
 *
 * 注意暫停時「已累積的餘額仍然可以折抵」，只是不能再抽新的。
 * 這符合消保法，也避免客人覺得錢被吞了。
 */
export function isCampaignOpen(s: Settings): {
  open: boolean;
  reason?: string;
} {
  if (!s.campaign_active) {
    return { open: false, reason: s.paused_reason ?? '活動暫停中' };
  }

  const now = Date.now();

  if (s.campaign_start_at && new Date(s.campaign_start_at).getTime() > now) {
    return { open: false, reason: '活動尚未開始' };
  }

  if (s.campaign_end_at && new Date(s.campaign_end_at).getTime() < now) {
    return { open: false, reason: '活動已結束' };
  }

  return { open: true };
}
