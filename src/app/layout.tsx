import type { Metadata, Viewport } from 'next';
import { Noto_Sans_TC } from 'next/font/google';

import './globals.css';

const notoTC = Noto_Sans_TC({
  variable: '--font-noto-tc',
  subsets: ['latin'],
  weight: ['400', '500', '700', '900'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: '消費抽獎',
  description: '來店消費即可抽獎，回饋點數累積折抵',
};

export const viewport: Viewport = {
  themeColor: '#e4572e',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant-TW" className={`${notoTC.variable} h-full`}>
      <body className="min-h-full font-sans antialiased">{children}</body>
    </html>
  );
}
