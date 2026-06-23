let backendUrl = "https://api.velosia.henrikheil.net"; // Default to production

document.addEventListener("DOMContentLoaded", async () => {
  const statusBadge = document.getElementById("status");
  const loginView = document.getElementById("login-view");
  const connectedView = document.getElementById("connected-view");
  const loginForm = document.getElementById("login-form");
  const logoutBtn = document.getElementById("logout-btn");
  const userEmailSpan = document.getElementById("user-email");
  const errorMsgDiv = document.getElementById("error-message");
  const envSelect = document.getElementById("env-select");
  const dashboardBtn = document.getElementById("btn-open-dashboard");

  // Load backend URL and check storage for existing token
  chrome.storage.local.get(["velosia_token", "velosia_user_email", "velosia_backend_url"], async (result) => {
    // Determine initially selected backend URL
    if (result.velosia_backend_url) {
      backendUrl = result.velosia_backend_url;
      envSelect.value = backendUrl.includes("localhost") ? "local" : "production";
    } else {
      backendUrl = "https://api.velosia.henrikheil.net";
      envSelect.value = "production";
      chrome.storage.local.set({ "velosia_backend_url": backendUrl });
    }

    updateDashboardLink();

    const token = result.velosia_token;
    if (token) {
      validateToken(token, result.velosia_user_email);
    } else {
      showLogin();
    }
  });

  // Handle environment change
  envSelect.addEventListener("change", () => {
    const selected = envSelect.value;
    backendUrl = selected === "local" ? "http://localhost:8000" : "https://api.velosia.henrikheil.net";
    
    updateDashboardLink();

    chrome.storage.local.set({ "velosia_backend_url": backendUrl }, () => {
      // Re-validate token under new environment
      chrome.storage.local.get(["velosia_token", "velosia_user_email"], (result) => {
        const token = result.velosia_token;
        if (token) {
          validateToken(token, result.velosia_user_email);
        } else {
          showLogin();
        }
      });
    });
  });

  // Update dashboard link dynamically
  function updateDashboardLink() {
    if (dashboardBtn) {
      dashboardBtn.href = backendUrl.includes("localhost") ? "http://localhost:5173" : "https://velosia.henrikheil.net";
    }
  }

  // Validate token with selected backend
  async function validateToken(token, savedEmail) {
    try {
      statusBadge.textContent = "Verbinde...";
      statusBadge.className = "status-badge disconnected";

      const response = await fetch(`${backendUrl}/api/auth/me`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      
      if (response.ok) {
        const user = await response.json();
        showConnected(user.email);
      } else {
        // Token expired or invalid on this backend
        showLogin();
      }
    } catch (err) {
      // Server offline/unreachable
      showConnected(savedEmail || "Lokal angemeldet");
      statusBadge.textContent = "Offline (Backend)";
      statusBadge.className = "status-badge disconnected";
    }
  }

  // Handle Login Submit
  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;

    errorMsgDiv.style.display = "none";

    try {
      const response = await fetch(`${backendUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.detail || "Login fehlgeschlagen.");
      }

      const data = await response.json();
      const token = data.access_token;

      // Save token in storage
      chrome.storage.local.set({ 
        "velosia_token": token,
        "velosia_user_email": email
      }, () => {
        showConnected(email);
      });

    } catch (err) {
      errorMsgDiv.textContent = err.message;
      errorMsgDiv.style.display = "block";
    }
  });

  // Handle Logout
  logoutBtn.addEventListener("click", () => {
    chrome.storage.local.remove(["velosia_token", "velosia_user_email"], () => {
      showLogin();
    });
  });

  function showConnected(email) {
    statusBadge.textContent = "Verbunden";
    statusBadge.className = "status-badge connected";
    loginView.style.display = "none";
    connectedView.style.display = "block";
    userEmailSpan.textContent = email;
    loadDrafts();
  }

  function showLogin() {
    statusBadge.textContent = "Nicht angemeldet";
    statusBadge.className = "status-badge disconnected";
    loginView.style.display = "block";
    connectedView.style.display = "none";
    userEmailSpan.textContent = "";
  }
});

// ---------------------------------------------------------------------------
// Draft list + "launch straight onto a platform" flow
// ---------------------------------------------------------------------------

// Load the user's drafts and initialise the auto-submit toggle from their saved
// profile preference, so an offer can be launched onto a platform in one click.
async function loadDrafts() {
  const listEl = document.getElementById("draft-list");
  const statusEl = document.getElementById("draft-list-status");
  const autoToggle = document.getElementById("auto-submit-toggle");
  if (!listEl) return;

  chrome.storage.local.get("velosia_token", async (data) => {
    const token = data.velosia_token;
    if (!token) return;

    try {
      const meRes = await fetch(`${backendUrl}/api/auth/me`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (meRes.ok) {
        const me = await meRes.json();
        if (autoToggle) autoToggle.checked = !!me.auto_submit;
      }
    } catch (e) { /* toggle just defaults to off */ }

    try {
      const res = await fetch(`${backendUrl}/api/drafts`, {
        headers: { "Authorization": `Bearer ${token}` }
      });
      if (!res.ok) throw new Error();
      renderDrafts(await res.json());
    } catch (e) {
      if (statusEl) statusEl.textContent = "Angebote konnten nicht geladen werden.";
    }
  });
}

function renderDrafts(drafts) {
  const listEl = document.getElementById("draft-list");
  const statusEl = document.getElementById("draft-list-status");
  if (!listEl) return;
  listEl.innerHTML = "";

  if (!drafts || drafts.length === 0) {
    if (statusEl) statusEl.textContent = "Noch keine Angebote. Fotografiere zuerst ein Teil im Dashboard.";
    return;
  }
  if (statusEl) statusEl.textContent = `${drafts.length} ${drafts.length === 1 ? "Angebot" : "Angebote"}:`;

  drafts.forEach((draft) => {
    const imgPath = draft.image_path || "";
    const imageUrl = imgPath
      ? (imgPath.startsWith("http") ? imgPath : `${backendUrl}${imgPath}`)
      : "";
    const card = document.createElement("div");
    card.style.cssText = "background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.07); border-radius:8px; padding:8px; display:flex; gap:8px; align-items:center;";
    card.innerHTML = `
      <img src="${imageUrl}" style="width:40px; height:40px; object-fit:cover; border-radius:5px; background:#000; flex-shrink:0;" />
      <div style="flex-grow:1; min-width:0;">
        <div style="font-size:12px; font-weight:600; color:#f8fafc; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(draft.title || "Unbenannt")}</div>
        <div style="font-size:11px; color:#09b0b7; font-weight:bold;">${draft.price != null ? Math.round(draft.price) + " €" : ""}</div>
      </div>
      <div style="display:flex; flex-direction:column; gap:4px; flex-shrink:0;">
        <button data-id="${draft.id}" data-platform="vinted" class="velosia-launch" style="background:#09b0b7; color:#000; border:none; border-radius:5px; font-size:10px; font-weight:bold; padding:4px 8px; cursor:pointer; white-space:nowrap;">Vinted</button>
        <button data-id="${draft.id}" data-platform="kleinanzeigen" class="velosia-launch" style="background:rgba(255,255,255,0.08); color:#f8fafc; border:1px solid rgba(255,255,255,0.12); border-radius:5px; font-size:10px; font-weight:bold; padding:4px 8px; cursor:pointer; white-space:nowrap;">Kleinanz.</button>
      </div>
    `;
    listEl.appendChild(card);
  });

  listEl.querySelectorAll(".velosia-launch").forEach((btn) => {
    btn.addEventListener("click", () => {
      startAutofill(parseInt(btn.dataset.id, 10), btn.dataset.platform);
    });
  });
}

// Queue the draft for autofill, then open the platform's "new listing" page in a
// new tab. The content script there reads the queued draft and fills the form.
function startAutofill(draftId, platform) {
  const autoToggle = document.getElementById("auto-submit-toggle");
  const autoSubmit = !!(autoToggle && autoToggle.checked);
  chrome.storage.local.set({
    velosia_pending_autofill: { draftId: draftId, platform: platform, autoSubmit: autoSubmit }
  }, () => {
    const url = platform === "vinted"
      ? "https://www.vinted.de/items/new"
      : "https://www.kleinanzeigen.de/p-anzeige-aufgeben.html";
    chrome.tabs.create({ url: url });
    window.close();
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str == null ? "" : String(str);
  return div.innerHTML;
}
