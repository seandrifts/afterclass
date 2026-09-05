'use server';

import { randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { generateDynamicCode, generateRedeemCode, normalizeCode } from '@/lib/codes';
import { runDraw } from '@/lib/draw-server';
import { grantPrize } from '@/lib/grant';
import { env } from '@/lib/env';
import { qrSvg } from '@/lib/qr';
import { getSettings } from '@/lib/settings';
import {
  clearStaffSession,
  getStaffSession,
  setStaffSession,
} from '@/lib/session';
import { loginStaff, MIN_PIN_LENGTH } from '@/lib/staff';
import { db } from '@/lib/supabase';
import { clientIpHash } from '@/lib/ratelimit';
import { getUserByWalletCode } from '@/lib/users';
import type { PrizeSnapshot } from '@/lib/types';

/** 查詢時往回看幾分鐘，判斷是不是剛剛才折抵過 */
const RECENT_REDEEM_MINUTES = 10;

export async function loginAction(_prev: unknown, formData: FormData) {
  const staffId = String(formData.get('staffId') ?? '');
  const pin = String(formData.get('pin') ?? '');
  const wantedRole = String(formData.get('role') ?? 'staff');

  if (!staffId || pin.length < MIN_PIN_LENGTH) {
    return { error: `請選擇人員並輸入 ${MIN_PIN_LENGTH} 位數 PIN` };
  }

  const result = await loginStaff(staffId, pin);

  if (!result.ok) {
    return {
      error:
        result.reason === 'LOCKED'
          ? `連續輸入錯誤，請 ${result.lockedMinutes} 分鐘後再試`
          : 'PIN 不正確',
    };
  }

  // 角色在後端再驗一次。前端的頁面分流只是動線設計，
  // 有人直接送出 owner 的 id 到店員登入頁時要擋得住
  if (wantedRole === 'owner' && result.session.role !== 'owner') {
    return { error: '這組帳號沒有後台權限' };
  }

  await setStaffSession(result.session);
  redirect(result.session.role === 'owner' ? '/admin' : '/staff');
}

export async function logoutAction() {
  await clearStaffSession();
  redirect('/staff/login');
}

/**
 * 查客人餘額。
 *
 * 只回傳店員需要看到的欄位。折抵畫面不該顯示客人的 LINE 頭像、
 * 累計消費之類的資訊，店員沒有理由需要知道。
 */
export async function lookupAction(_prev: unknown, formData: FormData) {
  const staff = await getStaffSession();
  if (!staff) return { error: '請先登入' };

  const code = normalizeCode(String(formData.get('walletCode') ?? ''));
  if (!code) return { error: '請輸入或掃描會員碼' };

  const user = await getUserByWalletCode(code);
  if (!user) return { error: '查不到這組會員碼' };
  if (user.is_blocked) return { error: '這個帳號已被停用' };

  const settings = await getSettings();

  /*
    找出這位客人最近一次折抵。

    實際會發生的情境：店員扣了 30 元，網路慢畫面沒更新，以為沒成功，
    重新查詢再扣一次，客人就少了 60 元。

    冪等鍵擋不住這個，因為那是全新的表單、全新的 key。只能在查詢時
    把「幾分鐘前才剛扣過」講出來，讓店員自己判斷。
  */
  const since = new Date(Date.now() - RECENT_REDEEM_MINUTES * 60_000);

  const { data: recent } = await db()
    .from('balance_transactions')
    .select('amount, created_at, staff:staff_id(name)')
    .eq('user_id', user.id)
    .eq('type', 'spend')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return {
    // 掃碼抽獎那條路要拿這個碼再送一次，查詢與抽獎是分開的兩步
    code,
    user: {
      id: user.id,
      name: user.display_name ?? '會員',
      balance: user.balance,
      maxRedeem: settings.max_redeem_per_visit,
      minBalance: settings.min_balance_to_redeem,
      recentRedeem: recent
        ? {
            amount: Math.abs(recent.amount),
            minutesAgo: Math.max(
              0,
              Math.round(
                (Date.now() - new Date(recent.created_at).getTime()) / 60_000,
              ),
            ),
            staffName:
              (recent.staff as unknown as { name: string } | null)?.name ??
              null,
          }
        : null,
    },
  };
}

/**
 * 折抵。
 *
 * idempotencyKey 由前端在按下確認前產生並固定住，重送同一個 key
 * 不會重複扣款。店員在收訊差的環境按了確認沒反應又按一次，
 * 這個保護就是防這個。
 */
export async function redeemAction(_prev: unknown, formData: FormData) {
  const staff = await getStaffSession();
  if (!staff) return { error: '請先登入' };

  const userId = String(formData.get('userId') ?? '');
  const amount = Number(formData.get('amount') ?? 0);
  const key = String(formData.get('idempotencyKey') ?? '') || randomUUID();

  if (!userId || !Number.isInteger(amount) || amount <= 0) {
    return { error: '折抵金額不正確' };
  }

  const { data, error } = await db()
    .rpc('redeem_balance', {
      p_user_id: userId,
      p_amount: amount,
      p_staff_id: staff.sid,
      p_idempotency_key: key,
    })
    .single<{ new_balance: number; txn_id: string; replayed: boolean }>();

  if (error) {
    return { error: describeRedeemError(error.message) };
  }

  return {
    success: {
      amount,
      newBalance: data.new_balance,
      txnId: data.txn_id,
      replayed: data.replayed,
    },
  };
}

/**
 * 撤銷剛才那筆折抵。
 *
 * 小吃店結帳出錯很常見，沒有這個功能客訴處理會很痛苦。
 * 超過時限就只能走後台人工調整，那會留下更完整的紀錄。
 */
export async function undoAction(_prev: unknown, formData: FormData) {
  const staff = await getStaffSession();
  if (!staff) return { error: '請先登入' };

  const txnId = String(formData.get('txnId') ?? '');
  if (!txnId) return { error: '找不到要撤銷的紀錄' };

  const { error } = await db()
    .rpc('undo_redeem', {
      p_txn_id: txnId,
      p_staff_id: staff.sid,
      p_window_secs: 300,
    })
    .single();

  if (error) {
    if (error.message.includes('UNDO_WINDOW_EXPIRED')) {
      return { error: '超過 5 分鐘無法撤銷，請洽老闆從後台調整' };
    }
    if (error.message.includes('ALREADY_UNDONE')) {
      return { error: '這筆已經撤銷過了' };
    }
    return { error: '撤銷失敗' };
  }

  return { undone: true };
}

/** 核銷實物券 */
export async function redeemCouponAction(_prev: unknown, formData: FormData) {
  const staff = await getStaffSession();
  if (!staff) return { error: '請先登入' };

  const code = String(formData.get('redeemCode') ?? '').replace(/\D/g, '');
  if (code.length !== 6) return { error: '請輸入 6 位核銷碼' };

  const { data, error } = await db()
    .rpc('redeem_coupon', { p_redeem_code: code, p_staff_id: staff.sid })
    .single<{ ok: boolean; reason: string | null; prize_name: string | null }>();

  if (error || !data?.ok) {
    return { error: '這張券無法核銷（已使用、已過期或不存在）' };
  }

  return { couponSuccess: { prizeName: data.prize_name } };
}

/**
 * 產生一次性動態 QR，給紙卡發完或補發時用。
 *
 * QR 圖在伺服器端產生後回傳 SVG。刻意不用第三方 QR 產生服務，
 * 那等於把每一組序號都送給外部網站。
 */
export type IssueResult =
  | { error: string }
  | { code: string; ttl: number; svg: string };

export async function issueTokenAction(): Promise<IssueResult> {
  const staff = await getStaffSession();
  if (!staff) return { error: '請先登入' };

  const settings = await getSettings();
  const code = generateDynamicCode();

  const { error } = await db().from('draw_tokens').insert({
    code,
    kind: 'dynamic',
    status: 'active',
    issued_by: staff.sid,
    issued_at: new Date().toISOString(),
    expires_at: new Date(
      Date.now() + settings.dynamic_token_ttl_sec * 1000,
    ).toISOString(),
  });

  if (error) return { error: '產生失敗，請再試一次' };

  const svg = await qrSvg(`${env.siteUrl}/d/${code}`, 240);

  return { code, ttl: settings.dynamic_token_ttl_sec, svg };
}

export type DrawForMemberResult =
  | { error: string }
  | {
      memberName: string;
      prize: PrizeSnapshot;
      creditAdded: number;
      newBalance: number;
      /** 實物券或免單才有，店員要念給客人記或請他看錢包 */
      redeemCode: string | null;
    };

/**
 * 店員用 iPad 代客人抽獎。
 *
 * 客人掃櫃檯的入會 QR 加入會員，打開自己的會員碼給店員掃，抽獎在
 * 店裡的 iPad 上完成，獎品當場進他的錢包。
 *
 * 跟客人自己掃碼那條路比起來少了兩個最會出事的環節：LINE 內建瀏覽器
 * 的登入，以及 30 分鐘領取時限。客人手機沒電或沒網路也能抽。
 *
 * 這裡仍然照原本的規矩開一張 token 再抽，不是直接寫餘額。抽獎次數的
 * 憑證、稽核紀錄、成本報表全部沿用同一套，不另闢蹊徑。
 */
export async function drawForMemberAction(
  _prev: unknown,
  formData: FormData,
): Promise<DrawForMemberResult> {
  const staff = await getStaffSession();
  if (!staff) return { error: '請先登入' };

  const walletCode = normalizeCode(String(formData.get('walletCode') ?? ''));
  if (!walletCode) return { error: '請掃描客人的會員碼' };

  const user = await getUserByWalletCode(walletCode);
  if (!user) return { error: '查不到這組會員碼，請客人先掃櫃檯的加入會員 QR' };
  if (user.is_blocked) return { error: '這個帳號已被停用' };

  /*
    先開一張只給這次用的 token。

    有效期給得很短，因為它從產生到抽完都在同一個動作裡，不需要留給
    客人掃。萬一中途失敗，這張很快就自己過期，不會變成可以被撿去用
    的漏洞。
  */
  const code = generateDynamicCode();
  const { error: insertError } = await db().from('draw_tokens').insert({
    code,
    kind: 'dynamic',
    status: 'active',
    issued_by: staff.sid,
    issued_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 120_000).toISOString(),
  });

  if (insertError) return { error: '產生失敗，請再試一次' };

  const outcome = await runDraw({
    code,
    ipHash: await clientIpHash(),
    userId: user.id,
  });

  if (!outcome.ok) {
    return { error: describeDrawError(outcome.error, outcome.reason) };
  }

  // 抽完立刻入帳。客人就站在櫃檯前，沒有「等他登入」這回事
  const redeemCode = generateRedeemCode();
  const { data: claim, error: claimError } = await db()
    .rpc('claim_token', {
      p_code: code,
      p_user_id: user.id,
      p_redeem_code: redeemCode,
    })
    .single<{
      ok: boolean;
      reason: string | null;
      prize_type: string | null;
      credit_added: number | null;
      new_balance: number | null;
      coupon_id: string | null;
    }>();

  if (claimError || !claim?.ok) {
    return {
      error:
        '抽中了但入帳失敗，請到後台「點數」查這位客人並手動補上，不要重抽',
    };
  }

  revalidatePath('/staff');

  return {
    memberName: user.display_name ?? '會員',
    prize: outcome.prize,
    creditAdded: claim.credit_added ?? 0,
    newBalance: claim.new_balance ?? user.balance,
    redeemCode: claim.coupon_id ? redeemCode : null,
  };
}

function describeDrawError(error: string, reason?: string): string {
  switch (error) {
    case 'CAMPAIGN_CLOSED':
      return reason ?? '活動目前暫停中';
    case 'NO_PRIZES':
      return '目前沒有可抽的獎項，請到後台確認';
    case 'PRIZE_OUT_OF_STOCK':
      return '獎項剛好發完了，請再試一次';
    default:
      return '抽獎失敗，請再試一次';
  }
}

function describeRedeemError(raw: string): string {
  if (raw.includes('INSUFFICIENT_BALANCE')) return '餘額不足';
  if (raw.includes('EXCEEDS_PER_VISIT_LIMIT')) return '超過單次折抵上限';
  if (raw.includes('INVALID_AMOUNT')) return '折抵金額不正確';
  return '折抵失敗，請再試一次';
}

export type StaffGrantResult =
  | {
      error: string;
      needsConfirm?: boolean;
      pending?: { walletCode: string; prizeId: string; note: string };
    }
  | { saved: true; message: string; redeemCode: string | null };

/**
 * 店員在現場送指定獎項。
 *
 * 跟後台走同一段程式（lib/grant.ts），差別只在面額上限：老闆不設限，
 * 店員受 settings.staff_grant_max_value 限制。
 *
 * 上限在這裡再擋一次，不能只靠前端的下拉選單 —— 那只是介面，有人直接
 * 送出超出範圍的 prizeId 時要擋得住。
 */
export async function staffGrantAction(
  _prev: unknown,
  formData: FormData,
): Promise<StaffGrantResult> {
  const staff = await getStaffSession();
  if (!staff) return { error: '請先登入' };

  const settings = await getSettings();
  if (settings.staff_grant_max_value <= 0) {
    return { error: '目前沒有開放店員送獎項，請洽老闆從後台設定' };
  }

  const outcome = await grantPrize({
    walletCode: String(formData.get('walletCode') ?? ''),
    prizeId: String(formData.get('prizeId') ?? ''),
    note: String(formData.get('note') ?? ''),
    actorId: staff.sid,
    confirmed: formData.get('confirmed') === 'true',
    // 店員端每一筆都要確認。現場人多手快，送錯的機會比後台高
    confirmAbove: 0,
    maxFaceValue: settings.staff_grant_max_value,
  });

  if (!outcome.ok) {
    return {
      error: outcome.error,
      needsConfirm: outcome.needsConfirm,
      pending: outcome.pending,
    };
  }

  revalidatePath('/staff');

  return {
    saved: true,
    message: outcome.message,
    redeemCode: outcome.redeemCode,
  };
}
