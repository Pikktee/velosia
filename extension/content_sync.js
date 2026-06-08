// Vintamie Session Sync Script
console.log("Vintamie Session Sync Script geladen!");

// Inject code to read page's localStorage and post a message to the content script
function syncSession() {
  const scriptContent = `
    (function() {
      const token = localStorage.getItem('vintamie_token');
      const email = localStorage.getItem('vintamie_user_email');
      window.postMessage({ 
        type: 'VINTAMIE_SYNC_SESSION', 
        token: token, 
        email: email 
      }, '*');
    })();
  `;
  
  const script = document.createElement('script');
  script.textContent = scriptContent;
  (document.head || document.documentElement).appendChild(script);
  script.remove();
}

// Listen for messages from the page context
window.addEventListener('message', (event) => {
  // Only accept messages from our own window and matching the type
  if (event.source !== window || !event.data || event.data.type !== 'VINTAMIE_SYNC_SESSION') {
    return;
  }

  const { token, email } = event.data;

  // Read current saved session first to avoid redundant writing
  const isProd = window.location.hostname.includes("vintamie.henrikheil.net");
  const detectedBackendUrl = isProd ? "https://api.vintamie.henrikheil.net" : "http://localhost:8000";

  chrome.storage.local.get(['vintamie_token', 'vintamie_user_email', 'vintamie_backend_url'], (result) => {
    if (token) {
      if (result.vintamie_token !== token || result.vintamie_user_email !== email || result.vintamie_backend_url !== detectedBackendUrl) {
        chrome.storage.local.set({ 
          vintamie_token: token, 
          vintamie_user_email: email || 'Google-Nutzer',
          vintamie_backend_url: detectedBackendUrl
        }, () => {
          console.log(`Vintamie: Sitzung und Backend-URL (${detectedBackendUrl}) erfolgreich mit Erweiterung synchronisiert!`);
        });
      }
    } else {
      // User is logged out on PWA, so remove token from extension storage as well
      if (result.vintamie_token) {
        chrome.storage.local.remove(['vintamie_token', 'vintamie_user_email'], () => {
          console.log("Vintamie: Abmeldung in der Erweiterung synchronisiert!");
        });
      }
    }
  });
});

// Run once on load
syncSession();

// Listen to storage events (triggers when localStorage is updated in another tab/action)
window.addEventListener('storage', (event) => {
  if (event.key === 'vintamie_token' || event.key === 'vintamie_user_email') {
    syncSession();
  }
});

// Periodically check as a fallback (e.g. if the single-page app changes storage without triggering storage event in the same tab)
setInterval(syncSession, 2000);
