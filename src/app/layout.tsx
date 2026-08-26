import type { Metadata, Viewport } from 'next';

import './globals.css';
import { kanzimi } from './fonts';
import { env } from '@/lib/env';
import { getSettings } from '@/lib/settings';
import { brandScaleCss, readableOn } from '@/lib/theme';

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
    /*
      分享到 LINE 時的預覽圖是相對路徑，Next.js 需要 metadataBase
      才解析得出完整網址。沒設定的話會退回 localhost，圖就出不來。
      目前在 Vercel 上靠系統變數僥倖正確，但綁自訂網域就會壞。
    */
    metadataBase: new URL(env.siteUrl),
    title: { default: shopName, template: `%s ‧ ${shopName}` },
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

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  /*
    主色從資料庫帶入。

    設定頁本來就有「主色」這個控制項，但它只是把值存進資料庫，
    介面完全沒有讀它，等於一個按了沒反應的按鈕。

    這裡把老闆挑的顏色推導成整組色階，用 style 覆蓋 globals.css
    的預設值。文字顏色依主色亮度自動選黑或白，否則挑到亮黃色時
    按鈕上的白字會完全看不見。
  */
  let brandCss = '';

  try {
    const settings = await getSettings();
    if (settings.primary_color) {
      brandCss =
        brandScaleCss(settings.primary_color) +
        `:root{--color-brand-on:${readableOn(settings.primary_color)}}`;
    }
  } catch {
    // 資料庫還沒設定好時就用 globals.css 的預設色
  }

  return (
    <html lang="zh-Hant-TW" className={`${kanzimi.variable} h-full`}>
      {brandCss ? (
        <style
          // 內容是從色碼推導出來的十六進位字串，不含使用者自由輸入的文字
          dangerouslySetInnerHTML={{ __html: brandCss }}
        />
      ) : null}
      <body className="min-h-full font-sans antialiased">
        {/* 鍵盤使用者的跳過導覽連結 */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-50 focus:rounded-xl focus:bg-brand-500 focus:px-4 focus:py-2 focus:font-bold focus:text-(--color-brand-on)"
        >
          跳到主要內容
        </a>
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
