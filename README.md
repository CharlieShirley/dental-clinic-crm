# 牙醫診所管理系統

牙醫診所用的病患管理系統（CRM），純靜態網站，可以直接放在 GitHub Pages。資料存在 Supabase。

## 功能

- 病患管理：病歷號、過敏與全身病史警示、標籤、會員等級
- 牙位圖：FDI 編號，恆牙 32 顆、乳牙 20 顆，可記錄牙齒狀態、牙面和備註
- 預約排程：依醫師分欄的時間表，提醒時段重疊和健保洗牙不足 180 天
- 洗牙與回診提醒：療程完成後自動排定下次回診日（洗牙 180 天、根管 7 天等）
- 櫃檯結帳：分健保與自費，支援療程計畫、口腔用品、儲值
- 庫存管理、營運報表、病患名單與銷售明細 CSV 匯出
- 登入與權限：第一位註冊的帳號是管理員，之後註冊的同事要管理員核准

## 檔案結構

```
dental-clinic-crm/
├── index.html          首頁（整個系統）
├── .nojekyll           讓 GitHub Pages 直接提供檔案
├── README.md           這份說明
├── css/
│   └── style.css       版面樣式
├── js/
│   ├── config.js       Supabase 連線設定（公開金鑰）
│   └── app.js          系統程式
├── images/
│   ├── favicon.svg     分頁小圖示
│   └── logo-tooth.svg  頁首標誌
└── supabase/
    ├── schema.sql      資料表與安全規則
    └── seed.sql        牙科範例資料
```

## 第一次使用

1. 打開網站，按「建立帳號」，用自己的 Email 註冊。**第一位註冊的人會成為管理員。**
2. 到信箱點確認連結，再回到網站登入。
3. 系統裡有範例資料（標示 SAMPLE DATA），試用完可以到「系統設定 → 資料管理」一鍵清除。
4. 同事註冊後，到「系統設定 → 帳號」按「核准」。

## Supabase 後台建議設定

在 Supabase 專案的 Authentication → URL Configuration：

- Site URL 填網站網址，例如 `https://你的帳號.github.io/dental-clinic-crm/`
- Redirect URLs 加入同一個網址

設定後，註冊確認信和重設密碼信的連結會直接回到網站。

## 安全說明

- `js/config.js` 裡的是 Supabase 的公開金鑰（anon key），本來就會出現在網頁中。
- 病患資料受 Supabase 資料表權限保護：沒登入、或沒被核准的帳號，讀不到也寫不進任何資料。
- 本系統為營運管理用途，不取代健保申報與正式電子病歷系統。
