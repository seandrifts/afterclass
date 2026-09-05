import 'server-only';

import { generateDynamicCode, generateRedeemCode } from './codes';
import { toSnapshot } from './draw';
import { db } from './supabase';
import { getUserByWalletCode } from './users';
import type { Prize } from './types';

/**
 * 指定獎項直接送給客人。
 *
 * 老闆在後台送、店員在店員端送，走的是這同一段程式。兩邊各寫一份的話，
 * 庫存扣減、快照、稽核紀錄遲早會有一邊漏掉，而那種漏掉不會噴錯，只會
 * 在月底對帳時變成一筆說不出來源的錢。
 *
 * 刻意沿用抽獎的完整路徑 —— 開一張 token、commit_draw 指定獎項、
 * claim_token 入帳。不是直接寫餘額，所以：
 *
 *   庫存會扣（commit_draw 內含上限檢查與失敗回滾）
 *   獎項內容存快照（之後改獎項不影響已送出的）
 *   成本報表算得到
 *   流水帳與 check_balance_integrity 都對得起來
 */
export type GrantOutcome =
  | { ok: false; error: string; needsConfirm?: boolean }
  | {
      ok: true;
      message: string;
      redeemCode: string | null;
      prizeName: string;
    };

export async function grantPrize(opts: {
  walletCode: string;
  prizeId: string;
  note: string;
  actorId: string;
  confirmed: boolean;
  /** 超過這個面額要二次確認 */
  confirmAbove: number;
  /**
   * 面額硬上限。店員端會帶入設定值，超過直接拒絕；
   * 老闆在後台送傳 null，不設限。
   */
  maxFaceValue: number | null;
}): Promise<GrantOutcome> {
  const walletCode = opts.walletCode.trim().toUpperCase();

  if (!walletCode) return { ok: false, error: '請輸入會員碼' };
  if (!opts.prizeId) return { ok: false, error: '請選擇要送出的獎項' };
  if (!opts.note.trim()) {
    return { ok: false, error: '請填寫原因，之後對帳才知道這筆是哪個活動' };
  }

  const user = await getUserByWalletCode(walletCode);
  if (!user) return { ok: false, error: '查不到這組會員碼' };
  if (user.is_blocked) return { ok: false, error: '這個帳號已被停用' };

  const { data: prizeRow } = await db()
    .from('prizes')
    .select('*')
    .eq('id', opts.prizeId)
    .maybeSingle();

  if (!prizeRow) return { ok: false, error: '找不到這個獎項' };
  const prize = prizeRow as Prize;

  /*
    面額上限在伺服器再擋一次。

    店員端的下拉選單本來就只列得出上限內的獎項，但那只是介面；
    有人直接送出一個超出範圍的 prizeId 時要擋得住。
  */
  if (opts.maxFaceValue !== null && prize.face_value > opts.maxFaceValue) {
    return {
      ok: false,
      error: `「${prize.name}」面額 ${prize.face_value} 元，超過店員可送出的上限 ${opts.maxFaceValue} 元。請老闆從後台送，或到設定調整上限。`,
    };
  }

  // 送錯免單跟送錯一元的代價差很多，高面額的要再確認一次
  if (prize.face_value > opts.confirmAbove && !opts.confirmed) {
    return {
      ok: false,
      needsConfirm: true,
      error: `「${prize.name}」面額 ${prize.face_value} 元，請確認是要送給「${user.display_name ?? '這位會員'}」。`,
    };
  }

  const code = generateDynamicCode();
  const { error: tokenError } = await db().from('draw_tokens').insert({
    code,
    kind: 'dynamic',
    status: 'active',
    issued_by: opts.actorId,
    issued_at: new Date().toISOString(),
    // 從產生到送出都在同一個動作裡，不需要留給客人掃
    expires_at: new Date(Date.now() + 120_000).toISOString(),
  });

  if (tokenError) return { ok: false, error: '建立失敗，請再試一次' };

  const { data: drawn, error: drawError } = await db()
    .rpc('commit_draw', {
      p_code: code,
      p_prize_id: prize.id,
      p_snapshot: toSnapshot(prize),
      p_ip_hash: null,
    })
    .single<{ ok: boolean; reason: string | null }>();

  if (drawError || !drawn?.ok) {
    return {
      ok: false,
      error:
        drawn?.reason === 'PRIZE_OUT_OF_STOCK'
          ? `「${prize.name}」的庫存已經發完了`
          : '建立失敗，請再試一次',
    };
  }

  const redeemCode = generateRedeemCode();
  const { data: claim, error: claimError } = await db()
    .rpc('claim_token', {
      p_code: code,
      p_user_id: user.id,
      p_redeem_code: redeemCode,
    })
    .single<{
      ok: boolean;
      credit_added: number | null;
      new_balance: number | null;
      coupon_id: string | null;
    }>();

  if (claimError || !claim?.ok) {
    return {
      ok: false,
      error: '獎項已扣庫存但入帳失敗，請重新整理確認後再處理',
    };
  }

  await db().from('audit_logs').insert({
    actor_type: 'staff',
    actor_id: opts.actorId,
    action: 'grant_prize',
    target_type: 'user',
    target_id: user.id,
    detail: {
      prize: prize.name,
      face_value: prize.face_value,
      cost: prize.cost,
      note: opts.note.trim(),
    },
  });

  return {
    ok: true,
    prizeName: prize.name,
    message: claim.credit_added
      ? `已送出「${prize.name}」，${user.display_name ?? '會員'} 目前 ${claim.new_balance} 元`
      : `已送出「${prize.name}」給 ${user.display_name ?? '會員'}`,
    redeemCode: claim.coupon_id ? redeemCode : null,
  };
}
