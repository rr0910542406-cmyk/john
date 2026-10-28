(() => {
  const signInButton = document.getElementById('google-sign-in');
  const signOutButton = document.getElementById('google-sign-out');
  const userPanel = document.getElementById('auth-user');
  const avatar = document.getElementById('auth-avatar');
  const userName = document.getElementById('auth-user-name');
  const message = document.getElementById('auth-message');

  if (!signInButton || !signOutButton || !userPanel || !avatar || !userName || !message) return;

  const setMessage = (text) => {
    message.textContent = text;
  };

  const config = window.PACE_FIREBASE_CONFIG;
  const requiredKeys = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const isConfigured = config && requiredKeys.every((key) => {
    const value = config[key];
    return typeof value === 'string' && value.trim() && !value.startsWith('YOUR_');
  });

  if (!isConfigured) {
    setMessage('Google 登入尚未設定，請先完成 Firebase 設定。');
    return;
  }

  if (!window.firebase?.auth) {
    setMessage('登入服務載入失敗，請檢查網路連線後重新整理。');
    return;
  }

  try {
    const app = window.firebase.apps.length
      ? window.firebase.app()
      : window.firebase.initializeApp(config);
    const auth = app.auth();
    const provider = new window.firebase.auth.GoogleAuthProvider();
    auth.languageCode = 'zh-TW';
    signInButton.disabled = false;
    setMessage('');

    signInButton.addEventListener('click', async () => {
      signInButton.disabled = true;
      setMessage('正在開啟 Google 登入…');
      try {
        await auth.signInWithPopup(provider);
      } catch (error) {
        const messages = {
          'auth/account-exists-with-different-credential': '此電子郵件已使用其他登入方式註冊。',
          'auth/popup-blocked': '瀏覽器封鎖了登入視窗，請允許彈出式視窗後重試。',
          'auth/popup-closed-by-user': '你已關閉登入視窗。',
          'auth/unauthorized-domain': '此網站網域尚未加入 Firebase 授權網域。',
          'auth/operation-not-allowed': 'Firebase 尚未啟用 Google 登入 Provider。'
        };
        setMessage(messages[error.code] || 'Google 登入失敗，請稍後再試。');
      } finally {
        signInButton.disabled = false;
      }
    });

    signOutButton.addEventListener('click', async () => {
      signOutButton.disabled = true;
      try {
        await auth.signOut();
        setMessage('已登出 Google 帳戶。');
      } catch {
        setMessage('登出失敗，請重新整理頁面後再試。');
      } finally {
        signOutButton.disabled = false;
      }
    });

    auth.onAuthStateChanged((user) => {
      signInButton.hidden = Boolean(user);
      userPanel.hidden = !user;
      if (!user) return;

      userName.textContent = user.displayName || user.email || 'Google 使用者';
      userName.title = user.email || userName.textContent;
      if (user.photoURL) {
        avatar.src = user.photoURL;
        avatar.hidden = false;
      } else {
        avatar.removeAttribute('src');
        avatar.hidden = true;
      }
      setMessage('');
    });
  } catch {
    setMessage('登入設定無效，請檢查 Firebase Web App 設定。');
  }
})();