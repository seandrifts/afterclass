# 小吃店消費抽獎系統 規劃文件

版本 v2.0 / 2026-07-28
主力機制為**儲值金**（對外稱「回饋點數」，見 §9.2）

---

## 0. 參數全部由後台控制

**設計原則：任何數字都不寫死在程式碼裡。**獎項名稱、成本、機率、餘額到期天數、折抵上限、活動開關、成本上限，全部存資料庫，由後台隨時修改，改完立即生效，不用重新部署。

下表是**初始值**（開工時先灌進資料庫），之後都在後台改：

| 項目 | 初始值 | 後台位置 |
|---|---|---|
| 店名 | （待填） | 設定 › 品牌 |
| 平均客單價 | 120 元 | 設定 › 成本試算 |
| 平均毛利率 | 55% | 設定 › 成本試算 |
| 每日來客數 | 80 人 | 設定 › 成本試算 |
| 每月成本上限 | 9,000 元 | 設定 › 成本煞車 |
| **餘額到期天數** | **90 天（滾動）** | 設定 › 儲值金規則 |
| **單次折抵上限** | **30 元** | 設定 › 儲值金規則 |
| 到期提醒提前天數 | 7 天 | 設定 › 儲值金規則 |
| 點數顯示倍率 | 1 元 = 10 點 | 設定 › 儲值金規則 |
| 紙卡序號有效期 | 90 天 | 設定 › 活動規則 |
| 動態 QR 存活秒數 | 60 秒 | 設定 › 活動規則 |
| 抽完到登入的領取時限 | 30 分鐘 | 設定 › 活動規則 |
| 各獎項金額與機率 | 見 §3.3 | 獎項管理 |

初始值全部已寫進 `supabase/seed.sql`，可直接執行。

後台詳細規格見 [`ADMIN.md`](./ADMIN.md)。

---

## 1. 活動概念

**一句話**：來店消費一次，抽獎一次，100% 中獎，抽到的金額存進 LINE 帳號累積，下次來店折抵。

**核心目的**（依重要性排序）：

1. **提高回訪頻率**。餘額會累積也會到期，「存了 47 元不用可惜」跟「再 7 天歸零」是兩股回店動力
2. **建立客戶名單**。取得 LINE 帳號後可以推播新品、公休、優惠
3. **拉高每次消費**。單次折抵有上限（30 元），客人為了用掉餘額會多來幾次而不是一次花光
4. 抽獎本身的娛樂感與口碑傳播

**為什麼選儲值金而不是折價券**：見 §3.2 的完整比較。簡短說是單筆金額小所以總成本更低、累積感帶來的回訪動機更強、而且不會在尖峰時段增加廚房負擔。

**不做的事**：不做集點卡。集點要累積多次才有回饋，週期太長。這套設計等於是「每次都有回饋的集點卡」，即時性跟累積感兼得。

---

## 2. 防作弊機制

### 2.1 威脅列表

| 威脅 | 說明 | 對策 |
|---|---|---|
| 沒消費也能抽 | 路人掃牆上 QR | 不用固定 QR |
| 一次消費抽多次 | 客人重複掃同一張 QR | token 一次性，掃走即作廢 |
| 截圖轉發 | 客人把 QR 傳給朋友 | token 60 秒過期 + 一次性 |
| 帳號農場 | 一人辦多個 LINE 帳號 | 一個 token 只能用一次，跟帳號無關。多帳號無法增加抽獎次數 |
| 店員私發 | 員工發卡給親友換獎品 | 每張 token 記錄發放者，後台比對「發放張數 vs 當日來客數」 |
| 券重複核銷 | 客人截圖券反覆使用 | 券核銷後立即失效，店員端才有核銷權限 |
| 前端改機率 | 客人開 DevTools 改中獎率 | 機率計算全在後端，前端只播動畫 |
| 猜碼 | 暴力嘗試 token 碼 | token 用 crypto 隨機 12 碼 + rate limit |

### 2.2 方案 A：預印一次性紙卡（主力，推薦）

**流程**：

1. 後台批次產生 500 組唯一碼（每組 8 碼英數 + 對應 QR）
2. 匯出 PDF，拿去印刷行印成小卡或貼紙（約 A4 一張 10 格，成本每張 0.3~0.5 元）
3. 後台**分批啟用**，一次只啟用 100 張。未啟用的碼掃了無效
4. 結帳時遞一張給客人
5. 客人回家或當場掃 QR → 抽獎

**為什麼小吃店適合這個**：

- 尖峰時段店員只需要「遞一張卡」，動作 1 秒，不用掏手機、不用點螢幕
- 老闆手不濕、不用碰手機（小吃店常在處理食物）
- 客人可以回家再抽，不佔用結帳動線
- 中老年客人不會當場操作，帶回家給小孩幫忙掃

**風險與對策**：

- 整疊卡被偷 → 分批啟用，一次只啟用 100 張，損失有上限
- 卡不小心多發 → 後台每日對帳，發放張數異常會看得出來
- 卡沒有到期概念 → 碼本身設 90 天有效期，過期無法抽

### 2.3 方案 B：店員手機動態 QR（備援）

櫃檯手機開店員後台，按「發放抽獎」產生 QR：

- 有效期 60 秒
- 只能被兌換 1 次，被掃走後畫面立刻換新
- 支援「一次發 N 張」（一桌多人時用）
- 記錄發放者、時間

**用在**：紙卡發完的時候、外送/外帶自取補發、客訴補償。

### 2.4 建議

兩種並行，後台都支援。紙卡當日常主力，動態 QR 當補發工具。

---

## 3. 獎項設計

**主力機制為儲值金。**每次抽獎抽到一筆金額，直接累積進帳戶餘額，下次消費折抵。實物券（滷蛋、飲料）作為次要獎項類型，架構已支援，可隨時在後台新增。

### 3.1 設計原則

1. **100% 中獎**。「銘謝惠顧」會讓客人下次不想抽，殺傷力遠大於省下的成本
2. **金額要拉開級距**。全部都是 1~5 元太平淡，要有 10 / 50 / 免單這種看得到的大獎才有抽獎感
3. **免單一定要設上限**。否則會有人揪 10 個人來消費 1500 元賭免單
4. **免單做成「下次折抵」不是「當場免單」**。強制產生第二次來店，中獎當下的興奮感一樣強
5. **餘額要有到期機制**。見 §3.5，這是整個設計的關鍵

### 3.2 儲值金 vs 實物券的取捨

兩者的成本結構相反，各有優劣：

| | 儲值金 | 實物券 |
|---|---|---|
| 成本 | 面額 100%（直接減收入） | 食材成本，約售價 35% |
| 成本效率 | 1.0 倍 | 2.8~2.9 倍 |
| 核銷率 | **高（估 80%）** | 低（估 45~55%） |
| 單筆金額 | 小（1~5 元） | 大（10~50 元感知價值） |
| 累積感 | **有，會想存到夠多再用** | 無，每張獨立 |
| 客人記得住 | **會，餘額一直在** | 容易忘記 |
| 店員操作 | 輸入折抵金額 | 核銷後要出餐，多一道工 |
| 廚房負擔 | 無 | 尖峰時段多做小菜會卡出餐 |

**選儲值金的理由**：單筆金額小所以總成本反而更低，累積感帶來的回訪動機比單張券強，而且不會在尖峰時段增加廚房負擔。小吃店中午一小時要出 60 碗麵，這時候有人來核銷燙青菜是會卡住的。

**代價**：儲值金核銷率高（客人不會忘記自己有錢），所以你發出去的幾乎都要付。這由「單筆金額小」和「餘額會到期」兩個機制來控制。

實物券之後可以當節慶活動加進來（例如中秋限定「烤肉套餐折抵」），架構已經支援，後台新增獎項時選類型即可。

### 3.3 獎項表

**基準：客單 120 元、每日 80 客、免單成本率 38%**（後台 › 設定 › 成本試算可調）

| 獎項 | 類型 | 面額 | 實際成本 | 權重 | 機率 | 名目期望成本 |
|---|---|---|---|---|---|---|
| 免單（下次消費全免，上限 150） | 免單 | 150 | 57 | 3 | 0.30% | 0.17 |
| 儲值金 50 元 | 儲值金 | 50 | 50 | 5 | 0.50% | 0.25 |
| 儲值金 20 元 | 儲值金 | 20 | 20 | 15 | 1.50% | 0.30 |
| 儲值金 10 元 | 儲值金 | 10 | 10 | 57 | 5.70% | 0.57 |
| 儲值金 5 元 | 儲值金 | 5 | 5 | 120 | 12.00% | 0.60 |
| 儲值金 3 元 | 儲值金 | 3 | 3 | 250 | 25.00% | 0.75 |
| 儲值金 2 元 | 儲值金 | 2 | 2 | 300 | 30.00% | 0.60 |
| 儲值金 1 元 | 儲值金 | 1 | 1 | 250 | 25.00% | 0.25 |
| **合計** | | | | **1000** | **100%** | **3.49** |

平均每次抽到 **3.32 元**儲值金。八成的人會抽到 1~3 元，這是刻意的，大部分人抽到小額才撐得起偶爾出現的 50 元和免單。

### 3.4 核銷率修正

儲值金的核銷率遠高於折價券，因為客人不會忘記自己帳戶裡有錢。

| 類型 | 名目期望 | 預估核銷率 | 實際期望成本 |
|---|---|---|---|
| 儲值金（全部級距） | 3.32 | 80% | 2.66 |
| 免單 | 0.17 | 90% | 0.15 |
| **合計** | **3.49** | | **2.81** |

**實際期望成本 2.81 元 / 客**，佔客單 120 的 **2.3%**。

以每日 80 客計，每月活動成本約 **6,700 元**。建議月上限設 9,000 留緩衝。

未核銷的 20% 主要來自兩種人：抽完沒登入的、餘額到期歸零的沉睡客。

**核銷率是估的，上線兩週後要用真實數據取代。**後台 › 報表會算出真實核銷率再回頭餵給成本試算。

### 3.5 餘額到期：滾動式（重要）

儲值金如果沒有到期日，會累積成永久性負債，帳務上很難處理，而且沉睡客的餘額永遠掛在那裡。

**採滾動到期：最後一次異動後 90 天歸零。**

```
客人 8/01 抽到 3 元   → 到期日 10/30
客人 8/15 抽到 2 元   → 到期日順延到 11/13
客人 9/02 折抵 20 元  → 到期日順延到 12/01
客人之後沒再來        → 12/01 餘額歸零
```

任何一次進帳或折抵都會把到期日往後推 90 天。

**為什麼這個設計好**：

- **熟客實質上永不過期**。一週來一次的人到期日一直被推後，不會有被坑的感覺
- **沉睡客自動清零**。三個月沒來的人餘額歸零，負債自動出清
- **產生最強的回流工具**。到期前 7 天推播「你的 47 元再 7 天就要歸零」，這則訊息的回流效果比抽獎本身還大

歸零由每日排程掃描執行，並寫一筆 `expire` 流水帳，隨時可查證。

### 3.6 折抵規則

| 參數 | 建議值 | 理由 |
|---|---|---|
| 最低使用門檻 | 無 | 儲值金的優點就是隨時可用，設門檻會削弱累積感 |
| **單次折抵上限** | **30 元** | 關鍵限制。防止存 200 元後一次幾乎免單，也讓店員好記 |
| 折抵單位 | 1 元 | |
| 是否可轉讓 | 否 | 綁定 LINE 帳號 |
| 是否可兌現 | 否 | 條款寫明 |
| 可否與其他優惠併用 | 否 | 條款寫明 |
| 餘額到期 | 最後異動後 90 天 | 見 §3.5 |

單次上限 30 元是整個成本控制的第二道防線。客單 120 時最多折 25%，你永遠收得到 75% 以上。

### 3.7 用「點數」包裝（建議）

抽到「1 元」感覺很寒酸，抽到「10 點」感覺好很多。同一件事，數字大就是比較爽，這是遊戲化的標準做法。

**1 元 = 10 點**，客人端一律顯示點數：

| 實際金額 | 客人看到 |
|---|---|
| 1 元 | 10 點 |
| 3 元 | 30 點 |
| 50 元 | 500 點 |

**店員端一律顯示元**，直接寫「可折抵 47 元」，店員不需要換算，避免出錯。錢包頁同時顯示「470 點（可折抵 47 元）」讓客人也看得懂。

這是純顯示層的設計，資料庫一律存「元」的整數，避免匯率換算的錯誤。後台可以一鍵關閉點數顯示。

### 3.8 效益對比

每月成本 6,700 元。回訪頻率如果從每月 4 次提升到 5 次（+25%）：

```
增額營收 = 80 客/日 × 120 元 × 25% × 30 天 = 72,000 元/月
以毛利 55% 計，增額毛利 = 39,600 元/月
```

成本 6,700 換 39,600 增額毛利。就算回訪只提升 10%，也還是划算。

**真正要盯的不是成本，是回訪率有沒有動。**如果跑一個月回訪率沒變化，代表問題在別的地方（口味、價格、地點），這時候該停掉活動而不是加碼獎項。

### 3.9 呈現方式

轉盤上顯示所有級距，包含 50 元跟免單。**大獎看得到本身就是參與動機**，即使機率只有 0.3%。

中獎畫面要強調累積感，不要只顯示「你抽到 3 元」：

```
        +30 點
   ─────────────────
   目前累積  270 點
   可折抵    27 元

   [█████████░] 再 30 點達單次折抵上限
```

**進度條的目標值設為「單次折抵上限」（300 點 = 30 元）**，這是最自然的里程碑，也是客人下次來店能一次用掉的最大金額。達標後進度條改為顯示「已達單次上限，來店即可折抵 30 元」。

進度條是儲值金機制的核心體驗。單看「+3 元」很無感，看到「離滿額只差 30 點」才會想再來。餘額超過 300 點後，多出來的部分照樣累積，只是要分次使用。

---

## 4. 使用者流程

### 4.1 關鍵設計：先抽獎，後登入

**不要**一進頁面就要求登入。要求登入會流失 40~60% 的人。

正確順序：

```
掃 QR
  ↓
直接看到轉盤（不需登入）
  ↓
按「開始抽獎」→ 動畫 → 中獎！
  ↓
「你抽中了 30 點！」
  ↓
「用 LINE 登入，把點數存進你的帳戶」  ← 這裡才要登入
  ↓
登入完成，點數入帳，顯示累積總額與進度條
```

先給多巴胺，再要帳號。客人已經知道自己中了什麼，登入意願會高很多。

**技術上**：抽獎結果在後端產生並綁定 token，暫存 30 分鐘。登入後把該 token 的中獎結果轉移到使用者帳號（儲值金入帳或產生實物券）。沒登入就是沒領，30 分鐘後失效。

**老客回訪時的畫面差異很重要。**已登入過的熟客再掃碼，抽完不需要再登入，直接顯示累積：

```
        +30 點
   ─────────────────
   270 點 → 300 點
   可折抵 30 元

   [██████████] 已達單次折抵上限！
```

「從 470 變 500」這個增長過程要做動畫。累積感是儲值金機制的全部價值所在，靜態顯示一個數字沒有效果。

### 4.2 完整頁面流程

| 頁面 | 路徑 | 說明 |
|---|---|---|
| 入口 / 抽獎 | `/d/[code]` | 掃 QR 進來，驗證 token，轉盤動畫 |
| 結果 | `/d/[code]/result` | 顯示獎品與累積，引導登入 |
| 登入 | `/login` | LINE Login 為主，Email magic link 備援 |
| **錢包** | `/wallet` | 餘額大字 + 到期倒數 + 折抵 QR + 進度條 |
| 明細 | `/wallet/history` | 餘額流水帳，每一筆進出都看得到 |
| 實物券 | `/wallet/coupons` | 實物券列表（目前無獎項，之後新增才會出現） |
| 券詳情 | `/wallet/coupons/[id]` | 大字顯示 6 位核銷碼 + QR |
| 活動辦法 | `/rules` | 機率公告、條款、個資聲明 |

**錢包頁是客人最常開的頁面**，設計重點：

```
┌─────────────────────────────┐
│         470 點               │
│      可折抵 47 元             │
│                             │
│    ┌─────────────┐          │
│    │  [QR CODE]  │          │
│    └─────────────┘          │
│      結帳時出示               │
│                             │
│  ⚠ 12/01 到期（還有 34 天）   │
│    來店消費即可延長            │
│                             │
│  [ 明細 ]  [ 抽獎紀錄 ]       │
└─────────────────────────────┘
```

QR 要**一打開就在畫面正中央**，不要藏在分頁裡。客人在櫃檯前面掏手機，多一次點擊就是多幾秒鐘的隊伍。

到期提示要寫「來店消費即可延長」，讓客人知道這不是催他趕快花光，而是回訪就會續期。

### 4.3 錯誤狀態處理

每個都要有明確畫面，不能只丟 error：

- token 不存在 → 「這組序號無效，請確認 QR 是否完整」
- token 已使用 → 「這組序號已經被使用過了，中獎結果是 XXX」（顯示原本結果，避免爭議）
- token 未啟用 → 「這組序號尚未開放，請洽店家」
- token 過期 → 「這組序號已超過使用期限」
- 動態 QR 過期 → 「QR 已過期，請店家重新產生」

---

## 5. 店員 / 老闆流程

### 5.1 店員端（手機網頁，`/staff`）

用簡單 PIN 登入，不用帳密。

| 功能 | 說明 |
|---|---|
| **折抵儲值金** | 掃客人帳戶 QR 或輸入 wallet code → 顯示餘額 → 輸入折抵金額 → 確認 |
| 核銷實物券 | 掃客人 QR 或輸入 6 位碼 → 顯示獎品內容 → 按確認核銷 |
| 發放動態 QR | 按鈕產生一次性 QR，可選張數 |
| 今日統計 | 今日發放數、抽獎數、折抵總額 |

**折抵畫面（最常用，要最快）：**

```
┌─────────────────────────────┐
│  陳小明                      │
│                             │
│   可折抵  47 元              │
│   （單次上限 30 元）          │
│                             │
│   折抵金額                   │
│   ┌───────────────────┐     │
│   │       30          │     │
│   └───────────────────┘     │
│                             │
│   [ 10 ] [ 20 ] [ 30 ] [全部] │
│                             │
│   ┌───────────────────┐     │
│   │    確認折抵 30 元   │     │
│   └───────────────────┘     │
└─────────────────────────────┘
```

快捷金額按鈕（10 / 20 / 30 / 全部）比鍵盤輸入快很多，尖峰時段這個差異很有感。「全部」自動取 `min(餘額, 單次上限)`。

**畫面要大字、高對比**，店員手濕、光線亂、動作要快。確認鍵要夠大避免誤觸，但也要跟其他鍵拉開距離。

折抵後顯示 3 秒綠色全螢幕：

```
   ✓ 已折抵 30 元
   剩餘 17 元
```

**防誤觸**：同一個帳戶 60 秒內重複折抵會跳警告要求二次確認，避免店員連按兩次扣兩次。真的要連續折抵（例如分開結帳）可以確認後繼續。

**撤銷**：折抵後 5 分鐘內可以按「撤銷上一筆」，退回餘額並寫一筆 `adjust` 流水帳。小吃店結帳出錯很常見，沒有這個功能會很痛苦。超過 5 分鐘就要走後台人工調整。

### 5.2 老闆後台（`/admin`）

完整規格見 [`ADMIN.md`](./ADMIN.md)。核心概念：**所有參數都在後台改，改完立即生效，不用重新部署。**

| 頁面 | 功能 |
|---|---|
| 儀表板 | 今日/本週/本月：發放、抽獎、核銷、實際成本、新客數、回訪率 |
| 獎項管理 | 調整獎項、機率、成本、庫存、上下架，**含即時期望成本試算與模擬器** |
| 序號管理 | 批次產生、分批啟用、作廢、匯出印刷 PDF |
| 券管理 | 查詢所有券、手動作廢、手動補發 |
| 會員名單 | LINE 名單、消費次數、最後來店日、匯出 CSV |
| 店員管理 | 新增店員、PIN 管理、查每位店員發放/核銷紀錄與對帳 |
| 報表 | 名目成本 vs 實際核銷成本、獎項分佈、時段分析 |
| 設定 | 品牌、活動規則、成本煞車、活動辦法內文、活動總開關 |

### 5.3 對帳機制

後台每日自動比對：

```
當日啟用序號數  vs  當日實際來客數
當日抽獎數      vs  當日發放數
```

差異超過閾值（例如 20%）自動標紅。這是抓店員私發的主要手段。

---

## 6. 資料庫設計

Supabase (PostgreSQL)。所有表開 RLS。

### 6.0 三個必須遵守的原則

**原則一：獎項只能停用，不能刪除。**已發出的券會參照到獎項，硬刪會造成孤兒資料與報表斷裂。後台的「刪除」按鈕實際執行 `is_active = false`。

**原則二：券必須快照中獎當下的獎項內容。**

這是很容易踩的坑。如果 `coupons` 只存 `prize_id`，顯示時 join `prizes` 撈名稱，那老闆在後台把「滷蛋一顆」改名成「豆干一份」的瞬間，**所有已發出但還沒核銷的滷蛋券會全部變成豆干券**。客人抽到的東西被追溯性竄改，這是實打實的客訴。

解法：抽獎當下把獎項內容整包 snapshot 成 jsonb 存進 token，領取時複製到 coupon。之後老闆怎麼改後台，已發出的券都不受影響。`prize_id` 保留純粹作為報表分組用。

同理，`cost` 也要快照。成本會浮動（滷蛋今天 5 元下個月 6 元），報表要算的是「當時的成本」。

**原則三：餘額必須有流水帳（ledger），不能只存一個數字。**

`users.balance` 只是快取。每一次進帳、折抵、到期歸零、人工調整，都必須在 `balance_transactions` 寫一筆，並記錄異動後的餘額。

理由：

- **爭議舉證**。客人說「我明明有 50 元怎麼變 20」，沒有流水帳你查不出來也講不清楚
- **對帳**。`sum(balance_transactions.amount)` 必須永遠等於 `users.balance`，對不上就是有 bug 或有人動過資料
- **報表**。實際成本要算的是「真正被折抵掉的金額」，這只能從流水帳來
- **回溯**。出錯時可以用流水帳重算餘額

餘額的任何變動都必須是「更新 balance + 寫 ledger」在同一個 transaction 內完成，不可分開。

### 6.0.1 儲值金與實物券的分流

抽中的獎項依類型走兩條路：

```
type = 'credit'                    → 直接進 users.balance + 寫 ledger，不產生券
type = 'item' / 'cash' / 'free_meal' → 產生一張 coupons，店員核銷
```

儲值金**不產生券**。餘額是一個數字，客人出示帳戶 QR，店員輸入折抵金額即可。這比「一堆 1 元券」好用非常多。

### 6.1 Schema

下列表按邏輯分組呈現，**實際 migration 的建表順序須為**：
`settings` → `staff` → `prizes` → `token_batches` → `users` → `draw_tokens` → `balance_transactions` → `coupons` → `prize_change_log` → `audit_logs`，否則外鍵會找不到參照對象。

```sql
-- 全域設定（單列表，id 固定為 1）
create table settings (
  id                       int primary key default 1 check (id = 1),

  -- 品牌
  shop_name                text not null default '',
  logo_url                 text,
  primary_color            text default '#E4572E',

  -- 活動開關
  campaign_active          boolean default false,
  campaign_start_at        timestamptz,
  campaign_end_at          timestamptz,
  paused_reason            text,

  -- 儲值金規則
  credit_expire_days       int  default 90,   -- 最後異動後幾天餘額歸零（滾動式）
  max_redeem_per_visit     int  default 30,   -- 單次消費最多折抵幾元（核心成本防線）
  min_balance_to_redeem    int  default 0,    -- 折抵門檻，0 = 無門檻
  expire_warn_days         int  default 7,    -- 到期前幾天推播提醒

  -- 點數包裝（純顯示層，DB 一律存「元」）
  points_display_enabled   boolean default true,
  points_per_dollar        int  default 10,   -- 1 元顯示為幾點

  -- 活動規則
  default_valid_days       int  default 21,   -- 實物券預設有效天數
  max_coupons_per_visit    int  default 1,    -- 每次消費限用幾張實物券
  card_token_valid_days    int  default 90,   -- 紙卡序號有效天數
  dynamic_token_ttl_sec    int  default 60,   -- 動態 QR 存活秒數
  claim_window_minutes     int  default 30,   -- 抽完到登入領取的時限
  allow_stack_promo        boolean default false,

  -- 成本試算基準（報表用，不影響邏輯）
  avg_ticket               int  default 120,
  gross_margin_pct         int  default 55,
  daily_customers          int  default 80,

  -- 成本煞車
  monthly_cost_cap         int,               -- null = 不限
  cost_cap_action          text default 'notify',  -- 'notify' | 'pause'
  cost_cap_notified_at     timestamptz,

  -- 保底機制
  pity_enabled             boolean default false,
  pity_threshold           int  default 20,

  -- 活動辦法（後台可編輯的富文本）
  rules_content            text default '',

  updated_at               timestamptz default now(),
  updated_by               uuid
);
insert into settings (id) values (1);

-- 獎項設定（可隨時在後台調整）
create table prizes (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,              -- 「儲值金 3 元」
  type          text not null,              -- 'credit' | 'item' | 'cash' | 'free_meal'
  credit_amount int,                        -- type='credit' 時的入帳金額（元）
  face_value    int not null,               -- 感知價值（顯示用）
  cost          int not null,               -- 實際成本（報表用）
  discount_amt  int,                        -- 現金券折抵金額
  min_spend     int default 0,              -- 使用門檻
  max_discount  int,                        -- 免單上限
  weight        int not null,               -- 權重（非百分比，避免浮點誤差）
  stock         int,                        -- null = 無限
  stock_used    int default 0,
  valid_days    int,                        -- null = 用 settings.default_valid_days
  terms         text,                       -- 這張券的專屬使用條件
  image_url     text,
  color         text,                       -- 轉盤上的區塊顏色
  sort_order    int default 0,
  is_active     boolean default true,       -- 停用而非刪除
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

-- 獎項異動紀錄（爭議舉證 + 防止偷改機率）
create table prize_change_log (
  id            uuid primary key default gen_random_uuid(),
  prize_id      uuid references prizes(id),
  changed_by    uuid,
  before        jsonb,
  after         jsonb,
  created_at    timestamptz default now()
);
create index on prize_change_log (created_at desc);

-- 使用者
create table users (
  id            uuid primary key default gen_random_uuid(),
  line_user_id  text unique,
  email         text unique,
  display_name  text,
  avatar_url    text,

  -- 儲值金。balance 是快取，真實來源是 balance_transactions
  -- 恆等式：balance = sum(balance_transactions.amount)
  balance             int not null default 0 check (balance >= 0),
  balance_expires_at  timestamptz,          -- 滾動到期，任何異動都往後推
  lifetime_earned     int not null default 0,
  lifetime_spent      int not null default 0,

  -- 帳戶識別碼，店員掃這個查餘額。與 id 分開避免洩漏內部 uuid
  wallet_code   text unique not null,

  created_at    timestamptz default now(),
  last_visit_at timestamptz,
  visit_count   int default 0,
  is_blocked    boolean default false
);
create index on users (balance_expires_at) where balance > 0;

-- 餘額流水帳（見 §6.0 原則三，這張表是餘額的唯一真實來源）
create table balance_transactions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) not null,
  type          text not null,
                -- 'earn'   抽獎入帳（正）
                -- 'spend'  消費折抵（負）
                -- 'expire' 到期歸零（負）
                -- 'adjust' 後台人工調整（正負皆可）
  amount        int not null,               -- 正為進帳，負為扣除
  balance_after int not null,               -- 異動後餘額，用來對帳
  source_type   text,                       -- 'draw' | 'redeem' | 'cron' | 'admin'
  source_id     uuid,                       -- 對應的 token / staff 操作 id
  staff_id      uuid references staff(id),  -- 折抵時是哪位店員操作
  note          text,                       -- 人工調整必填原因
  created_at    timestamptz default now()
);
create index on balance_transactions (user_id, created_at desc);
create index on balance_transactions (created_at desc);
create index on balance_transactions (type, created_at desc);

-- 抽獎序號（紙卡 + 動態 QR 共用）
create table draw_tokens (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,       -- 8 碼英數（紙卡）或 12 碼（動態）
  kind          text not null,              -- 'card' | 'dynamic'
  batch_id      uuid references token_batches(id),
  status        text not null default 'inactive',
                -- 'inactive' | 'active' | 'drawn' | 'claimed' | 'expired' | 'voided'
  issued_by     uuid references staff(id),
  issued_at     timestamptz,
  expires_at    timestamptz,
  drawn_at      timestamptz,                -- 抽獎時間
  prize_id      uuid references prizes(id), -- 抽中什麼（報表分組用）
  prize_snapshot jsonb,                     -- 中獎當下的獎項完整內容（見 §6.0 原則二）
  claimed_by    uuid references users(id),  -- 誰領走的
  claimed_at    timestamptz,
  ip_hash       text,                       -- 防刷用
  created_at    timestamptz default now()
);
create index on draw_tokens (code);
create index on draw_tokens (status, expires_at);

-- 序號批次
create table token_batches (
  id            uuid primary key default gen_random_uuid(),
  name          text,                       -- 「2026-08 第一批」
  quantity      int not null,
  activated_qty int default 0,
  note          text,
  created_at    timestamptz default now()
);

-- 實物券 / 免單券。只有 type != 'credit' 的獎項才會產生
-- 儲值金不產生券，直接進 users.balance
create table coupons (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references users(id) not null,
  token_id      uuid references draw_tokens(id) unique not null,
  redeem_code   text unique not null,       -- 6 位數字，店員輸入用

  -- 報表分組用（顯示一律不看這個）
  prize_id      uuid references prizes(id) not null,

  -- 中獎當下的快照。後台改獎項不影響已發出的券
  prize_name    text not null,
  prize_type    text not null,
  face_value    int  not null,
  cost_at_draw  int  not null,              -- 當時成本，報表用
  discount_amt  int,
  min_spend     int  default 0,
  max_discount  int,
  terms         text,
  image_url     text,

  status        text not null default 'active',
                -- 'active' | 'used' | 'expired' | 'voided'
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_by       uuid references staff(id),
  void_reason   text,
  created_at    timestamptz default now()
);
create index on coupons (user_id, status);
create index on coupons (redeem_code);

-- 店員
create table staff (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  pin_hash      text not null,
  role          text default 'staff',       -- 'staff' | 'owner'
  is_active     boolean default true,
  created_at    timestamptz default now()
);

-- 操作稽核（爭議時的證據）
create table audit_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_type    text,                       -- 'user' | 'staff' | 'system'
  actor_id      uuid,
  action        text not null,              -- 'issue_token' | 'draw' | 'claim' | 'redeem' | 'void'
  target_type   text,
  target_id     uuid,
  detail        jsonb,
  ip_hash       text,
  created_at    timestamptz default now()
);
create index on audit_logs (created_at desc);
```

### 6.2 狀態機

**draw_tokens**：

```
inactive ──啟用──▶ active ──抽獎──▶ drawn ──登入領取──▶ claimed
                     │                 │
                     └──過期──▶ expired ◀┘（30分鐘未領取）
                     │
                     └──後台作廢──▶ voided
```

**coupons**（僅實物券／免單券）：

```
active ──店員核銷──▶ used
   │
   ├──到期──▶ expired
   └──後台作廢──▶ voided
```

**餘額**沒有狀態機，只有流水帳。任何時點的餘額 = 該使用者所有流水的總和：

```
earn   +30  →  balance_after 30
earn   +20  →  balance_after 50
spend  -30  →  balance_after 20
expire -20  →  balance_after 0
```

### 6.3 併發安全

抽獎、核銷、折抵都要防 race condition。用 Postgres 的原子更新，**絕對不要「先查再寫」**。

```sql
-- 抽獎：只有 active 才能轉成 drawn，用 WHERE 保證原子性
update draw_tokens
set status = 'drawn', prize_id = $1, prize_snapshot = $2, drawn_at = now()
where code = $3 and status = 'active' and expires_at > now()
returning *;
-- 回傳 0 列 = 已被別人抽走或無效
```

```sql
-- 核銷實物券：同理
update coupons
set status = 'used', used_at = now(), used_by = $1
where redeem_code = $2 and status = 'active' and expires_at > now()
returning *;
```

有庫存限制的獎項，扣庫存要放在同一個 transaction 裡。

### 6.4 餘額折抵的原子操作（最容易寫錯的地方）

折抵是最危險的操作。客人在兩支手機同時出示、或店員誤觸兩次，都可能造成餘額扣成負數或重複扣款。

**錯誤寫法**（絕對不要）：

```ts
const user = await getUser(id)          // 查餘額
if (user.balance >= amount) {           // 檢查
  await setBalance(id, user.balance - amount)   // 寫回
}
```

查跟寫之間有空隙，兩個請求同時進來會兩個都通過檢查。

**正確寫法**：把檢查條件放進 `WHERE`，讓資料庫保證原子性，並用 Postgres function 把「扣餘額 + 寫 ledger」包在同一個 transaction：

```sql
create or replace function redeem_balance(
  p_user_id  uuid,
  p_amount   int,
  p_staff_id uuid
) returns table (new_balance int, txn_id uuid)
language plpgsql
as $$
declare
  v_max_per_visit int;
  v_expire_days   int;
  v_new_balance   int;
  v_txn_id        uuid;
begin
  select max_redeem_per_visit, credit_expire_days
    into v_max_per_visit, v_expire_days
    from settings where id = 1;

  if p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  if p_amount > v_max_per_visit then
    raise exception 'EXCEEDS_PER_VISIT_LIMIT';
  end if;

  -- 關鍵：條件放在 WHERE，餘額不足時直接不更新
  update users
     set balance            = balance - p_amount,
         lifetime_spent     = lifetime_spent + p_amount,
         -- 折抵也算異動，到期日往後滾
         balance_expires_at = now() + (v_expire_days || ' days')::interval,
         last_visit_at      = now(),
         visit_count        = visit_count + 1
   where id = p_user_id
     and balance >= p_amount
     and is_blocked = false
   returning balance into v_new_balance;

  if not found then
    raise exception 'INSUFFICIENT_BALANCE';
  end if;

  insert into balance_transactions
    (user_id, type, amount, balance_after, source_type, staff_id)
  values
    (p_user_id, 'spend', -p_amount, v_new_balance, 'redeem', p_staff_id)
  returning id into v_txn_id;

  return query select v_new_balance, v_txn_id;
end;
$$;
```

`users.balance` 上的 `check (balance >= 0)` 是最後一道保險。就算邏輯有漏，資料庫層也不會讓餘額變成負數。

入帳（`earn_balance`）與到期歸零（`expire_balances`）用同樣的模式撰寫。

### 6.5 每日到期排程

```sql
-- 每日執行，把過期的餘額歸零並寫 ledger
create or replace function expire_balances() returns int
language plpgsql
as $$
declare
  v_count int := 0;
begin
  with expired as (
    update users
       set balance = 0
     where balance > 0
       and balance_expires_at is not null
       and balance_expires_at < now()
    returning id, balance as old_balance
  )
  insert into balance_transactions
    (user_id, type, amount, balance_after, source_type)
  select id, 'expire', -old_balance, 0, 'cron' from expired;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
```

用 Supabase `pg_cron` 每日凌晨 4 點執行，避開營業時間。

### 6.6 對帳檢查

每日排程順便跑一次一致性檢查，結果進後台告警區：

```sql
-- 這個查詢必須永遠回傳 0 列。有任何一列就代表餘額被繞過 ledger 動過
select u.id, u.balance, coalesce(sum(t.amount), 0) as ledger_sum
from users u
left join balance_transactions t on t.user_id = u.id
group by u.id, u.balance
having u.balance <> coalesce(sum(t.amount), 0);
```

---

## 7. 抽獎演算法

**全部在後端執行。前端只負責播動畫，動畫結果由後端回傳決定。**

```
1. 撈出 is_active = true 且 (stock is null or stock_used < stock) 的獎項
2. 計算 totalWeight = sum(weight)
3. r = crypto.randomInt(0, totalWeight)   ← 用 crypto，不要 Math.random()
4. 累加權重找到落點
5. 在同一個 transaction 內：
   - update draw_tokens 狀態（帶 WHERE status='active'）+ 寫入 prize_snapshot
   - update prizes stock_used += 1
   - insert audit_logs
6. 回傳獎項給前端
```

**注意抽獎當下不入帳。**中獎結果先存在 token 上，等客人登入按「領取」才真正進餘額。理由是沒登入就沒有帳戶可以入帳，而且這樣「抽完不領」的人不會產生成本。

領取（`/api/claim`）才執行入帳，同樣包在一個 transaction：

```
1. 驗證 token 狀態為 drawn 且未超過 claim_window_minutes
2. 依 prize_snapshot.type 分流：
   - 'credit'  → 呼叫 earn_balance()，users.balance += amount
                 + 寫 balance_transactions ('earn')
                 + balance_expires_at = now() + credit_expire_days
   - 其他      → 產生一張 coupons，快照獎項內容
3. update draw_tokens status = 'claimed', claimed_by, claimed_at
4. insert audit_logs
```

**用 weight 整數而非百分比**，避免浮點數累加誤差。後台顯示時再換算成百分比。

**保底機制**：同一 LINE 帳號連續 20 次都抽到最小獎（1 元），第 21 次強制排除最低級距。熟客一週來三次，連續抽到 1 元會覺得被耍。成本增加極小但體感差很多，建議開啟。

**未登入的人沒有保底**，因為沒有帳號無法追蹤連續次數。這不是問題，會連抽 20 次的一定是熟客，熟客一定登入過。

---

## 8. 技術架構

| 層 | 選型 | 理由 |
|---|---|---|
| 框架 | Next.js 16 (App Router) | 你已熟悉，Server Actions 適合這種簡單 CRUD |
| 資料庫 | Supabase (Postgres) | 你在 Ongsa 已用過，RLS 好用，免費額度夠 |
| 登入 | LINE Login (OAuth 2.0) | 台灣普及率 90%+ |
| 備援登入 | Supabase Auth Magic Link | 給沒 LINE 的客人 |
| 樣式 | Tailwind CSS | |
| 動畫 | Framer Motion 或純 CSS | 轉盤用 CSS transform + cubic-bezier 就夠 |
| QR 產生 | `qrcode` npm | |
| QR 掃描 | `html5-qrcode` | 店員端掃券用 |
| PDF 匯出 | `pdf-lib` 或 `@react-pdf/renderer` | 紙卡排版 |
| 部署 | Vercel | |
| 網域 | 短網域（例如 `xxx.tw`） | QR 內容越短，圖案越簡單越好掃 |

**QR 網址設計**：`https://短網域/d/A7K2M9P4`

網址越短，QR 的 module 密度越低，用便宜印刷、小尺寸、油污環境下也掃得動。這對小吃店很重要。避免用 UUID 當網址。

### 8.1 API 端點

| Method | 路徑 | 說明 | 保護 |
|---|---|---|---|
| GET | `/api/token/[code]` | 查 token 狀態 | rate limit |
| POST | `/api/draw` | 執行抽獎 | rate limit + token 驗證 |
| POST | `/api/claim` | 登入後領取（入帳或發券） | 需登入 |
| GET | `/api/wallet` | 餘額 + 到期日 + 實物券 | 需登入 |
| GET | `/api/wallet/history` | 餘額流水帳 | 需登入 |
| GET | `/api/staff/lookup/[walletCode]` | 查客人餘額 | 需店員 |
| POST | `/api/staff/redeem-balance` | **折抵儲值金** | 需店員 |
| POST | `/api/staff/redeem-coupon` | 核銷實物券 | 需店員 |
| POST | `/api/staff/undo` | 撤銷 5 分鐘內的折抵 | 需店員 |
| POST | `/api/staff/issue` | 產生動態 QR | 需店員 |
| GET | `/api/admin/stats` | 統計 | 需 owner |
| POST | `/api/admin/batch` | 產生序號批次 | 需 owner |
| POST | `/api/admin/adjust-balance` | 人工調整餘額 | 需 owner |

**Rate limit**：以 IP 為單位，`/api/draw` 每分鐘 5 次、`/api/token/*` 每分鐘 20 次。用 Upstash Redis 或 Supabase 自建。

**`/api/staff/redeem-balance` 要做冪等性保護。**前端送出時帶一個 `idempotency_key`（uuid），後端在 5 分鐘內遇到相同 key 直接回傳原本結果而不重複扣款。店員在收訊差的環境按了確認沒反應又按一次，這個保護就是防這個。

### 8.2 安全檢查清單

- [ ] 機率計算 100% 在後端
- [ ] 所有狀態轉換用原子 UPDATE + WHERE 條件
- [ ] **餘額異動一律走 Postgres function，扣款條件放在 WHERE 不放在應用層 if**
- [ ] **`users.balance` 有 `check (balance >= 0)` 當最後保險**
- [ ] **每次餘額異動都寫 ledger，且在同一 transaction**
- [ ] **折抵 API 有 idempotency key，防重複扣款**
- [ ] **單次折抵上限在後端驗證，不能只靠前端擋**
- [ ] Supabase service role key 只在 Server Action / Route Handler 使用，絕不出現在 client bundle
- [ ] 所有表開 RLS，使用者只能讀自己的 `coupons` 與 `balance_transactions`
- [ ] `wallet_code` 與 `users.id` 分開，避免洩漏內部 uuid
- [ ] 店員 PIN 用 bcrypt hash
- [ ] admin 路由用 middleware 保護，比對 email 白名單
- [ ] token code 用 `crypto.randomBytes`，不用時間戳或流水號
- [ ] 排除易混淆字元（0/O、1/I/l），紙卡用大寫 + 數字，字集 `ABCDEFGHJKMNPQRSTUVWXYZ23456789`
- [ ] rate limit
- [ ] audit log 記錄所有敏感操作
- [ ] 每日跑 §6.6 的餘額一致性檢查

---

## 9. 法規與注意事項（台灣）

### 9.1 抽獎活動

「消費即可參加」的抽獎屬於**促銷活動**，不需要事前許可。但要注意：

- **公平交易法**：活動辦法（獎項、機率、期限、使用條件）必須明確公告，不可有誤導性標示。頁面要有 `/rules` 且從抽獎頁可點進去
- **獎項機率必須真實**。公告 0.3% 就要真的是 0.3%。後台調機率要留 audit log
- **免單獎的稅務**：個人中獎所得單次超過 2 萬元需扣繳並開扣繳憑單。本活動最大獎 150 元，不觸及

### 9.2 儲值金的性質（改用儲值金後新增）

台灣《零售業等商品（服務）禮券定型化契約應記載及不得記載事項》規範的是**消費者預先付款購買**的禮券，該規範禁止設定使用期限，也要求業者提供履約保證。

本活動的儲值金**不屬於預付型商品**，因為客人沒有付錢購買，是消費後獲得的回饋。因此：

- 可以設定使用期限（本案為滾動 90 天）
- 不需要提供履約保證或信託
- 不可兌換現金（要在條款明確寫）

**但條款措辭很重要。**要一律使用「回饋點數」「回饋金」這類詞彙，**避免使用「儲值」「儲值金」「預付」等字眼**，因為這些詞可能讓主管機關或客人誤認為預付型商品。

本文件內部為了溝通方便沿用「儲值金」，**對外文案一律改用「回饋點數」**。

其他要注意的：

- 到期規則必須事前明確告知，不能事後才說會過期。錢包頁要常駐顯示到期日
- 單次折抵上限要寫在條款跟錢包頁，不能等結帳時才跟客人說
- 活動終止時，已發出的點數必須讓客人用完或提供等值補償

### 9.3 個資法

- 收集 LINE ID、姓名、頭像屬個資，登入頁必須有**告知同意**：蒐集目的、使用範圍、保存期限、當事人權利
- 提供刪除帳號功能
- 不得將名單提供第三方

### 9.4 消費者保護

- 點數的使用條件（單次上限、到期規則、不可兌現）要在錢包頁直接寫清楚，不能只寫在條款頁
- 活動如果要提前終止，已發出的點數必須讓客人用完，或提供等值補償

### 9.5 建議條款要寫的

對外一律稱「回饋點數」，見 §9.2。

```
一、活動方式
1. 每次消費（不限金額）可獲得抽獎序號一組
2. 序號僅限使用一次，遺失恕不補發
3. 抽獎後需以 LINE 或 Email 登入領取，未於 30 分鐘內領取視為放棄

二、獎項與機率
4. 獎項機率如下：（系統自動產生完整表格）
5. 免單獎折抵上限 150 元，超過部分需自付

三、回饋點數規則
6. 10 點等值新台幣 1 元，僅供本店消費折抵
7. 點數不得轉讓、兌換現金、不找零
8. 每次消費最多折抵 30 元，不可與其他優惠併用
9. 點數自最後一次異動日起 90 日內有效；期間內任一次獲得或使用點數，
   有效期自動順延 90 日。逾期未使用之點數將自動歸零，恕不補發
10. 點數為本店提供之消費回饋，非預先付款購買之商品或服務

四、其他
11. 本店保留活動修改與終止之權利，但已發出之點數權益不受影響
12. 個資僅用於本活動與本店行銷通知，得隨時要求刪除
```

第 9 條的措辭要特別小心，必須把「滾動順延」講清楚，否則客人會以為是硬性 90 天。第 10 條是為了明確排除禮券法規的適用。

---

## 10. 開發階段規劃

### Phase 1：MVP（可上線試跑）

- [ ] Supabase 建表 + RLS + 餘額原子函式（`earn_balance` / `redeem_balance` / `expire_balances`）
- [ ] 抽獎頁 `/d/[code]`：驗證 token + 轉盤動畫 + 後端抽獎 API
- [ ] LINE Login + 領取流程（儲值金入帳 / 實物券產生分流）
- [ ] 錢包 `/wallet`：餘額 + 到期倒數 + 折抵 QR + 明細
- [ ] 店員端 `/staff`：PIN 登入 + 查餘額 + 折抵 + 撤銷
- [ ] 後台 `/admin`：序號批次產生 + 啟用 + 獎項設定 + 基本設定
- [ ] 每日到期排程 + 餘額一致性檢查
- [ ] 活動辦法頁

### Phase 2：實務工具

- [ ] 紙卡 PDF 匯出（含排版模板）
- [ ] 店員端動態 QR 發放
- [ ] 店員端 QR 掃描（比手動輸入快很多）
- [ ] 後台儀表板 + 成本報表 + 模擬器
- [ ] 實物券核銷流程（獎項新增後才需要）
- [ ] Email magic link 備援登入

### Phase 3：留客與成長

- [ ] LINE 官方帳號整合，**點數到期前 7 天推播提醒（對回訪率影響最大的單一功能）**
- [ ] 會員分群名單匯出（沉睡客、高頻客、即將到期）
- [ ] 保底機制
- [ ] 分享機制：中獎畫面可分享到 LINE / IG，帶 OG image
- [ ] 對帳異常告警

### Phase 4：優化

- [ ] 抽獎動畫優化、音效
- [ ] 節慶限定獎項（此時可加入實物券）
- [ ] 生日點數自動發放
- [ ] 累積里程碑獎勵（例如累計抽 50 次送大獎）

---

## 11. 上線前檢查

### 技術

- [ ] 用測試序號跑完整流程 10 次
- [ ] 同一序號重複掃，確認擋得住
- [ ] 兩支手機同時掃同一序號，確認只有一個成功（併發測試）
- [ ] 抽 1000 次驗證機率分佈接近設定值
- [ ] 老人家的舊手機測試（Android 8 / iOS 14）
- [ ] 弱網環境測試（抽獎中斷網會怎樣）
- [ ] 店內實際光線下掃 QR 測試

**餘額相關（最重要，錢的問題不能出錯）：**

- [ ] 餘額 10 元時折抵 30 元，確認被擋
- [ ] 兩個請求同時折抵同一帳戶，確認只有一筆成功、餘額不會變負
- [ ] 折抵超過單次上限，確認後端擋得住（不是只有前端擋）
- [ ] 重送同一個 idempotency key，確認不會重複扣款
- [ ] 折抵後撤銷，確認餘額正確退回且 ledger 有兩筆
- [ ] 手動把 `balance_expires_at` 改成昨天，跑排程確認歸零且寫了 expire 流水
- [ ] 到期後再抽獎，確認到期日正確重設
- [ ] 跑 §6.6 一致性檢查，確認回傳 0 列

### 營運

- [ ] 店員教育訓練，折抵流程演練（重點：單次上限、撤銷怎麼用）
- [ ] 印製活動告示（桌牌、牆貼），寫清楚怎麼玩、點數怎麼用
- [ ] 決定第一批序號數量（建議 200 張，跑一週看數據再調）
- [ ] 設定成本上限告警值
- [ ] 條款上線並可從抽獎頁點進去

### 試跑期

**建議先跑 2 週，只發 200~300 張**，觀察：

| 指標 | 健康值 | 不健康時該做什麼 |
|---|---|---|
| 掃碼率（抽獎 ÷ 發放） | > 60% | 低於 50% 先改告示與 QR，其他都別動 |
| 登入轉換率 | > 70% | 低於 50% 檢查登入流程是不是太複雜 |
| 折抵率（已折抵 ÷ 已發放點數） | 60~85% | 過低代表金額太小沒動機，過高代表成本失控 |
| 回訪間隔 | 應縮短 | 沒縮短代表活動無效，該停不該加碼 |

**掃碼率是第一順位。**如果沒人掃，後面的數字都不用看。

---

## 12. 需要決定的事

1. 店名、品牌色、字體風格
2. 抽獎次數門檻：不限金額 vs 滿額才給（建議不限金額，小吃店客單差異小）
3. 是否採用點數包裝（1 元 = 10 點，建議採用，見 §3.7）
4. 單次折抵上限 30 元是否合適（依實際客單調整）
5. 是否申請 LINE 官方帳號（強烈建議，到期提醒推播是整個系統回訪率的關鍵）
6. 短網域要不要買
6. 第一批印多少張紙卡、印在什麼材質
