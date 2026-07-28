import 'server-only';

import { generateWalletCode } from './codes';
import { db } from './supabase';
import type { User } from './types';

export async function getUserById(id: string): Promise<User | null> {
  const { data } = await db()
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  return (data as User) ?? null;
}

export async function getUserByWalletCode(code: string): Promise<User | null> {
  const { data } = await db()
    .from('users')
    .select('*')
    .eq('wallet_code', code)
    .maybeSingle();
  return (data as User) ?? null;
}

/**
 * 依 LINE 使用者建立或取得帳號。
 *
 * wallet_code 有唯一索引，理論上可能撞號。10 碼取自 25 個字元的字集，
 * 空間約 9.5e13，撞號機率極低，但仍然重試幾次而不是直接失敗。
 */
export async function upsertLineUser(profile: {
  userId: string;
  displayName?: string;
  pictureUrl?: string;
}): Promise<User> {
  const existing = await db()
    .from('users')
    .select('*')
    .eq('line_user_id', profile.userId)
    .maybeSingle();

  if (existing.data) {
    // 頭像和暱稱會變，每次登入同步一次
    const { data } = await db()
      .from('users')
      .update({
        display_name: profile.displayName ?? null,
        avatar_url: profile.pictureUrl ?? null,
      })
      .eq('id', (existing.data as User).id)
      .select('*')
      .single();

    return data as User;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await db()
      .from('users')
      .insert({
        line_user_id: profile.userId,
        display_name: profile.displayName ?? null,
        avatar_url: profile.pictureUrl ?? null,
        wallet_code: generateWalletCode(),
      })
      .select('*')
      .single();

    if (!error && data) return data as User;

    // 23505 = unique_violation
    if (error?.code !== '23505') {
      throw new Error(`建立帳號失敗：${error?.message}`);
    }

    // 撞到的可能是 line_user_id（同一人同時開兩個分頁登入），
    // 這種情況另一個請求已經建好帳號了，直接撿回來用。
    // 撞到 wallet_code 才需要換一組重試。
    const raced = await db()
      .from('users')
      .select('*')
      .eq('line_user_id', profile.userId)
      .maybeSingle();

    if (raced.data) return raced.data as User;
  }

  throw new Error('建立帳號失敗：wallet_code 連續撞號');
}
