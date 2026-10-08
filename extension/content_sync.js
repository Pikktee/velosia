// Velosia Session Sync Script
console.log("Velosia Session Sync Script geladen!");

// Content scripts share the page origin's localStorage, so the session can be read
// directly — no script injection into the page and no window.postMessage round trip.
function syncSession() {
  let token = null;
  let email = null;
  try {
    token = window.localStorage.getItem('velosia_token');
    email = window.localStorage.getItem('velosia_user_email');
  } catch (e) {
    return;
  }

  const isProd = window.location.hostname === "velosia.henrikheil.net";
  const detectedBackendUrl = isProd ? "https://api.velosia.henrikheil.net" : "http://localhost:8000";

  chrome.storage.local.get(['velosia_token', 'velosia_user_email', 'velosia_backend_url'], (result) => {
    if (token) {
      if (result.velosia_token !== token || result.velosia_user_email !== email || result.velosia_backend_url !== detectedBackendUrl) {
        chrome.storage.local.set({
          velosia_token: token,
          velosia_user_email: email || 'Google-Nutzer',
          velosia_backend_url: detectedBackendUrl
        }, () => {
          console.log(`Velosia: Sitzung und Backend-URL (${detectedBackendUrl}) erfolgreich mit Erweiterung synchronisiert!`);
        });
      }
    } else {
      // User is logged out on PWA, so remove token from extension storage as well
      if (result.velosia_token) {
        chrome.storage.local.remove(['velosia_token', 'velosia_user_email'], () => {
          console.log("Velosia: Abmeldung in der Erweiterung synchronisiert!");
        });
      }
    }
  });
}

// Run once on load
syncSession();

// Listen to storage events (triggers when localStorage is updated in another tab/action)
window.addEventListener('storage', (event) => {
  if (event.key === 'velosia_token' || event.key === 'velosia_user_email') {
    syncSession();
  }
});

// Periodically check as a fallback (e.g. if the single-page app changes storage without triggering storage event in the same tab)
setInterval(syncSession, 2000);
