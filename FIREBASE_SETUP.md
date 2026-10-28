# Google 登入設定

Google 登入使用 Firebase Authentication。Firebase Web 設定會放在前端，因此不是密碼或私密金鑰；請勿把服務帳戶金鑰放進網站。

1. 在 Firebase Console 建立專案，新增 Web App。
2. 在 Authentication 的登入提供者中啟用 Google。
3. 到 Authentication 的設定，將網站網域加入授權網域。GitHub Pages 請加入 `rr0910542406-cmyk.github.io`；本機測試可加入 `localhost`。
4. 複製 Firebase Web App 設定，填入 `firebase-config.js` 的 `apiKey`、`authDomain`、`projectId` 與 `appId`。
5. 使用 HTTPS 網站或 localhost 開啟網站，按「使用 Google 登入」測試。

目前登入只驗證 Google 身分並顯示帳戶資訊。運動紀錄仍只儲存在本機瀏覽器，不會因登入而同步到雲端。