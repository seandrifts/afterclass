import Link from 'next/link';

import { requireOwner } from '@/lib/auth-guard';

const NAV = [
  { href: '/admin', label: '儀表板' },
  { href: '/admin/prizes', label: '獎項' },
  { href: '/admin/tokens', label: '序號' },
  { href: '/admin/credits', label: '點數' },
  { href: '/admin/settings', label: '設定' },
] as const;

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const owner = await requireOwner();

  return (
    <div className="min-h-dvh bg-surface">
      <header className="border-b border-line bg-raised">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <span className="font-black">後台</span>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-ink-soft">{owner.name}</span>
            <Link href="/staff" className="text-brand-600 underline">
              店員端
            </Link>
          </div>
        </div>

        {/* 老闆很可能在店裡用手機看，導覽列要能橫向捲動 */}
        <nav className="mx-auto max-w-5xl overflow-x-auto px-4">
          <ul className="flex gap-1 pb-2">
            {NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="block whitespace-nowrap rounded-xl px-4 py-2 text-sm font-bold text-ink-soft hover:bg-brand-50"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
