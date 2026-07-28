import Link from 'next/link';

import { DrawFlow } from './draw-flow';
import { normalizeCode } from '@/lib/codes';
import { getSettings, isCampaignOpen } from '@/lib/settings';
import { getUserSession } from '@/lib/session';
import { db } from '@/lib/supabase';
import { isClaimable, readToken } from '@/lib/tokens';
import { getUserById } from '@/lib/users';
import type { Prize } from '@/lib/types';
import { LinkButton, StatusScreen } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function DrawPage(props: PageProps<'/d/[code]'>) {
  const { code: rawCode } = await props.params;
  const code = normalizeCode(rawCode);

  const settings = await getSettings();
  const campaign = isCampaignOpen(settings);

  if (!campaign.open) {
    return (
      <StatusScreen
        emoji="🍜"
        title={campaign.reason ?? '活動暫停中'}
        detail="造成不便敬請見諒。已累積的點數仍然可以在結帳時折抵。"
        action={
          <LinkButton href="/wallet" variant="secondary">
            查看我的點數
          </LinkButton>
        }
      />
    );
  }

  const state = await readToken(code);

  if (state.kind === 'not_found') {
    return (
      <StatusScreen
        emoji="🔍"
        title="查不到這組序號"
        detail="請確認 QR Code 是否完整，或對照小卡上的序號重新輸入。"
      />
    );
  }

  if (state.kind === 'inactive') {
    return (
      <StatusScreen
        emoji="⏳"
        title="這組序號尚未開放"
        detail="這批序號還沒啟用，請洽店家人員。"
      />
    );
  }

  if (state.kind === 'expired') {
    return (
      <StatusScreen
        emoji="📅"
        title="這組序號已過期"
        detail="超過使用期限了，下次消費會拿到新的一組。"
      />
    );
  }

  if (state.kind === 'voided') {
    return (
      <StatusScreen
        emoji="🚫"
        title="這組序號已作廢"
        detail="如果你認為這是誤判，請洽店家人員協助處理。"
      />
    );
  }

  // 已經被領走了。顯示原本抽中什麼，避免爭議
  if (state.kind === 'claimed') {
    const session = await getUserSession();
    const mine = session?.uid === state.token.claimed_by;

    return (
      <StatusScreen
        emoji="✅"
        title="這組序號已經領取過了"
        detail={
          <>
            當時抽中的是{' '}
            <strong className="text-ink">{state.prize.name}</strong>。
            {mine ? '已經在你的帳戶裡了。' : null}
          </>
        }
        action={
          mine ? (
            <LinkButton href="/wallet">查看我的點數</LinkButton>
          ) : undefined
        }
      />
    );
  }

  // 抽完但還沒領，且已超過領取時限
  if (state.kind === 'drawn' && !isClaimable(state.token, settings.claim_window_minutes)) {
    return (
      <StatusScreen
        emoji="⌛"
        title="超過領取時限了"
        detail={
          <>
            這組序號抽中了{' '}
            <strong className="text-ink">{state.prize.name}</strong>，
            但因為超過 {settings.claim_window_minutes} 分鐘沒有登入領取，
            已經失效。下次抽完記得馬上登入。
          </>
        }
      />
    );
  }

  const session = await getUserSession();
  const user = session ? await getUserById(session.uid) : null;

  const { data: prizeRows } = await db()
    .from('prizes')
    .select('*')
    .eq('is_active', true)
    .gt('weight', 0)
    .order('sort_order');

  return (
    <>
      <DrawFlow
        code={code}
        settings={settings}
        prizes={(prizeRows ?? []) as Prize[]}
        user={
          user
            ? { displayName: user.display_name, balance: user.balance }
            : null
        }
        alreadyDrawn={state.kind === 'drawn' ? state.prize : null}
      />
      <footer className="pb-8 text-center">
        <Link href="/rules" className="text-sm text-ink-faint underline">
          活動辦法與中獎機率
        </Link>
      </footer>
    </>
  );
}
