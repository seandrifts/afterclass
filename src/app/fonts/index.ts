import localFont from 'next/font/local';

/**
 * 柑仔蜜。
 *
 * 原始 TTF 有 4.3 MB，中文字型都這樣，因為要涵蓋數萬個字。客人在
 * 店門口用行動網路掃 QR，載那麼大的檔案要好幾秒，這期間畫面不是
 * 空白就是用系統字閃一下再跳字。
 *
 * 所以拆成兩份（見 scripts/subset-font.mjs）：
 *
 *   core  介面文案與常用字，262 KB，隨頁面載入
 *   ext   其餘常用漢字，靠 unicode-range 讓瀏覽器只在真的遇到
 *         罕用字時才去抓。客人的 LINE 暱稱或老闆自訂的獎項名稱
 *         可能出現任何字，這份是為了那些情況準備的
 *
 * display 用 swap：先用系統字把內容顯示出來，字型到了再換。
 * 對「掃碼就要馬上看到轉盤」的場景，寧可字型晚一點也不要白畫面。
 */
export const kanzimi = localFont({
  src: [
    {
      path: './kanzimi-core.woff2',
      /*
        柑仔蜜不是可變字型，只有單一字重（OS/2 usWeightClass 800）。

        宣告成 400–900 是刻意的：這樣瀏覽器認為任何字重都由這個字檔
        負責，就不會替 font-bold 硬畫一層合成粗體 —— 那對本來就已經
        很粗的字型只會糊成一團。

        代價是 font-bold 跟一般文字看起來一樣重，層次要靠字級與顏色
        來分，不能靠字重。
      */
      weight: '400 900',
      style: 'normal',
    },
  ],
  variable: '--font-kanzimi',
  display: 'swap',
  // 系統字的量測基準，減少字型切換時的版面跳動
  adjustFontFallback: 'Arial',
  fallback: [
    'PingFang TC',
    'Hiragino Sans CNS',
    'Noto Sans TC',
    'Microsoft JhengHei',
    'sans-serif',
  ],
});
