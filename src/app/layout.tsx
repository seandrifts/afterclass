import type { Metadata, Viewport } from 'next';
import { Noto_Sans_TC } from 'next/font/google';

import './globals.css';
import { getSettings } from '@/lib/settings';

const notoTC = Noto_Sans_TC({
  variable: '--font-noto-tc',
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  display: 'swap',
});

/**
 * 標題與分享資訊從資料庫的店名帶入。
 *
 * 客人把中獎畫面分享到 LINE 群組時，出現的是店名而不是「消費抽獎」
 * 這種通用字樣，對口碑傳播差很多。老闆在後台改店名就會同步。
 */
export async function generateMetadata(): Promise<Metadata> {
  let shopName = '消費抽獎';

  try {
    const settings = await getSettings();
    if (settings.shop_name) shopName = settings.shop_name;
  } catch {
    // 資料庫還沒設定好時不要讓整個 app 起不來
  }

  const description = '來店消費即可抽獎，100% 中獎，回饋點數下次折抵';

  return {
    title: { default: shopName, template: `%s · ${shopName}` },
    description,
    applicationName: shopName,
    manifest: '/manifest.webmanifest',
    icons: {
      icon: [{ url: '/favicon-32.png', sizes: '32x32', type: 'image/png' }],
      apple: '/apple-icon.png',
    },
    appleWebApp: { capable: true, title: shopName, statusBarStyle: 'default' },
    openGraph: {
      title: shopName,
      description,
      type: 'website',
      locale: 'zh_TW',
      images: [{ url: '/og.png', width: 1200, height: 630 }],
    },
    twitter: {
      card: 'summary_large_image',
      title: shopName,
      description,
      images: ['/og.png'],
    },
    // 客人的錢包與抽獎頁不該被搜尋引擎收錄
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  themeColor: '#e4572e',
  width: 'device-width',
  initialScale: 1,
  // 不鎖縮放。視力不好的客人需要放大，鎖住是可及性問題
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant-TW" className={`${notoTC.variable} h-full`}>
      <body className="min-h-full font-sans antialiased">
        {/* 鍵盤使用者的跳過導覽連結 */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-xl focus:bg-brand-500 focus:px-4 focus:py-2 focus:font-bold focus:text-white"
        >
          跳到主要內容
        </a>
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
