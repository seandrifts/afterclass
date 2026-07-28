# LINE Login 設定

約 10 分鐘。做完客人就能登入領取點數，整條流程就通了。

---

## 步驟 1：建立 Provider

1. 開 <https://developers.line.biz/console/>
2. 用你的 LINE 帳號登入（手機會跳確認）
3. 第一次使用會要你建立 **Provider**

Provider 是「品牌」層級的容器，底下可以掛多個 Channel。填店名即可，
例如 `小吃店`。這個名稱**客人在授權畫面上會看到**，所以不要填測試用的字。

已經有 Provider 的話直接用既有的。

---

## 步驟 2：建立 LINE Login Channel

在 Provider 頁面按 **Create a new channel**，選 **LINE Login**。

| 欄位 | 填什麼 |
|---|---|
| Channel type | LINE Login |
| Provider | 上一步建的 |
| Channel icon | 店家 logo（客人授權時會看到，建議上傳） |
| **Channel name** | 店名，例如「小吃店消費抽獎」。**客人會看到** |
| **Channel description** | 「消費抽獎與回饋點數」之類 |
| **App types** | 勾 **Web app**（必要，不勾之後拿不到 Channel ID） |
| Email address | 你的信箱 |

其他留空，勾同意條款，按 **Create**。

---

## 步驟 3：設定 Callback URL

進入剛建好的 Channel → 上方 **LINE Login** 分頁 → **Callback URL**。

**兩個都要填，一行一個：**

```
https://afterclass-psi.vercel.app/auth/line/callback
http://localhost:3100/auth/line/callback
```

第一個是正式環境，第二個是本機開發。少了第二個，本機測登入會失敗。

按 **Update**。

> **這裡必須完全一模一樣。**LINE 比對 callback 時連結尾斜線都算。
> 多一個 `/` 或少一個字元都會回報 `400 invalid_request`。

---

## 步驟 4：取得 Channel ID 與 Secret

同一個 Channel 裡：

| 要什麼 | 在哪 |
|---|---|
| **Channel ID** | **Basic settings** 分頁，一串純數字 |
| **Channel secret** | **Basic settings** 分頁最下方，按 Show |

Channel secret 等於這個登入功能的密碼，外洩的話別人可以冒用你的店名
做釣魚登入頁。跟資料庫金鑰一樣的等級，只放環境變數。

---

## 步驟 5：填進環境變數

### 本機

編輯 `.env.local`：

```
LINE_CHANNEL_ID=（純數字）
LINE_CHANNEL_SECRET=（那串英數）
```

### Vercel

Settings → Environment Variables，新增三個：

| Name | Value |
|---|---|
| `LINE_CHANNEL_ID` | 同上 |
| `LINE_CHANNEL_SECRET` | 同上 |
| `SITE_URL` | `https://afterclass-psi.vercel.app` |

`SITE_URL` 雖然程式會自動從 Vercel 的系統變數推導，但 LINE 的
callback 比對不容許任何差異，明確指定最保險。

改完環境變數要**重新部署**才生效（Deployments → 最新那筆 → `⋯` → Redeploy）。

---

## 步驟 6：發布 Channel（最容易漏掉）

新建的 Channel 預設是 **Developing** 狀態，**只有 Channel 管理員本人
登得進去**，其他客人一律被拒絕。

在 Channel 頁面上方，Channel name 旁邊會看到 `Developing` 標籤，
點它旁邊的 **Publish** 按鈕改成 **Published**。

沒做這步的話，你自己測都正常，客人一用就失敗，而且錯誤訊息不會明說原因。

---

## 步驟 7：測試完整流程

1. 後台 → 序號 → 產生批次 → 啟用
2. SQL Editor 撈一組：
   ```sql
   select code from draw_tokens where status = 'active' limit 1;
   ```
3. 手機開 `https://afterclass-psi.vercel.app/d/那組序號`
4. 按開始抽獎 → 轉盤 → 中獎
5. 按「用 LINE 登入領取」→ 授權 → 應該回到結果頁並顯示已入帳
6. 開 `/wallet` 確認餘額與 QR 都在

第 5 步能通，整條流程就完成了。

---

## 常見錯誤

| 畫面訊息 | 原因 | 怎麼修 |
|---|---|---|
| `400 invalid_request` | Callback URL 沒對上 | 檢查步驟 3，注意結尾斜線 |
| 授權後回到 `/login?error=bad_state` | 登入連結放太久過期（10 分鐘） | 重新操作一次 |
| 授權後回到 `/login?error=line_failed` | Channel ID 或 Secret 填錯 | 檢查步驟 5，注意有沒有多空白 |
| 客人說登不進去但你可以 | Channel 還在 Developing | 做步驟 6 |
| `403 Forbidden` | App types 沒勾 Web app | 回步驟 2 補勾 |

---

## 之後值得做的：LINE 官方帳號

這裡設定的是 **LINE Login**，只負責登入。

另外還有 **LINE 官方帳號（Messaging API）**，可以主動推播訊息給客人。
把兩者綁在一起之後，就能在點數到期前 7 天推「你的 470 點再 7 天歸零」。

**這則推播對回訪率的貢獻比抽獎本身還大。**抽獎的真正價值是幫你合法
取得一份會回應的客戶名單，推播才是把名單變成營業額的那一步。

免費方案每月 200 則，以小吃店的規模夠用。等基本流程跑順了再做。
