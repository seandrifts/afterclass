import Link from 'next/link';

/**
 * 店員 / 老闆 的切換。
 *
 * 原本是放在頁面最下方的一行小字連結，實際用起來有問題：兩個登入頁
 * 的版面幾乎一樣（標題、姓名、圓點、鍵盤），點過去畫面沒什麼變化，
 * 使用者會以為連結壞掉沒反應。
 *
 * 改成放在最上方的分段切換，選中的那一邊有明顯底色，切換的瞬間
 * 就看得出來自己在哪一邊。
 */
export function RoleSwitch({ current }: { current: 'staff' | 'owner' }) {
  const tabs = [
    { key: 'staff' as const, label: '店員', href: '/staff/login' },
    { key: 'owner' as const, label: '老闆', href: '/admin/login' },
  ];

  return (
    <nav
      className="grid grid-cols-2 gap-1.5 rounded-2xl bg-brand-100/60 p-1.5"
      aria-label="登入身分"
    >
      {tabs.map((tab) => {
        const active = tab.key === current;

        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-12 cursor-pointer items-center justify-center rounded-xl text-base font-bold transition-colors duration-200 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-300 ${
              active
                ? 'bg-brand-500 text-white shadow-sm'
                : 'text-ink-soft hover:bg-white/70'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
