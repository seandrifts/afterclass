import 'server-only';

import { db } from './supabase';
import type { DrawToken, PrizeSnapshot } from './types';

export type TokenState =
  | { kind: 'ready'; token: DrawToken }
  | { kind: 'drawn'; token: DrawToken; prize: PrizeSnapshot }
  | { kind: 'claimed'; token: DrawToken; prize: PrizeSnapshot }
  | { kind: 'not_found' }
  | { kind: 'inactive' }
  | { kind: 'expired' }
  | { kind: 'voided' };

/**
 * 查序號目前的狀態。
 *
 * 每種狀態都要有明確的畫面，不能只丟一個錯誤。客人在店門口掃到
 * 一組壞掉的序號時，「這組序號已經被使用過了」跟「發生錯誤」
 * 對他來說是完全不同的資訊。
 */
export async function readToken(code: string): Promise<TokenState> {
  const { data } = await db()
    .from('draw_tokens')
    .select('*')
    .eq('code', code)
    .maybeSingle();

  if (!data) return { kind: 'not_found' };

  const token = data as DrawToken;
  const expired =
    token.expires_at !== null && new Date(token.expires_at).getTime() < Date.now();

  switch (token.status) {
    case 'voided':
      return { kind: 'voided' };

    case 'expired':
      return { kind: 'expired' };

    case 'inactive':
      return { kind: 'inactive' };

    case 'active':
      return expired ? { kind: 'expired' } : { kind: 'ready', token };

    case 'drawn':
      // 抽完但還沒領。顯示原本的中獎結果，避免爭議
      return {
        kind: 'drawn',
        token,
        prize: token.prize_snapshot as PrizeSnapshot,
      };

    case 'claimed':
      return {
        kind: 'claimed',
        token,
        prize: token.prize_snapshot as PrizeSnapshot,
      };
  }
}

/** 抽完到登入領取之間的時限有沒有過 */
export function isClaimable(token: DrawToken, windowMinutes: number): boolean {
  if (token.status !== 'drawn' || !token.drawn_at) return false;
  const deadline =
    new Date(token.drawn_at).getTime() + windowMinutes * 60_000;
  return Date.now() < deadline;
}
