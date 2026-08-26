# 字型

由 `scripts/subset-font.mjs` 從原始 TTF 裁切產生，請勿手動編輯。

- `kanzimi-core.woff2` 介面文案與常用字，隨頁面立即載入
- `kanzimi-ext.woff2` 其餘常用漢字，靠 unicode-range 延後載入

換字型或新增大量新文案後重新產生：

    node scripts/subset-font.mjs /路徑/字型.ttf
