// Velosia Form Autofiller Content Script
console.log("Velosia Content Script geladen!");

// State
let drafts = [];
let isOverlayOpen = false;
let backendUrl = "https://api.velosia.henrikheil.net"; // Default to production

function openCameraOverlay() {
  if (document.getElementById("velosia-camera-iframe")) return;

  const iframe = document.createElement("iframe");
  iframe.id = "velosia-camera-iframe";
  iframe.src = chrome.runtime.getURL("camera.html");
  iframe.setAttribute("allow", "camera");
  
  Object.assign(iframe.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "100vw",
    height: "100vh",
    border: "none",
    zIndex: "9999999",
    backgroundColor: "transparent"
  });

  document.body.appendChild(iframe);
}

function closeCameraOverlay() {
  const iframe = document.getElementById("velosia-camera-iframe");
  if (iframe) iframe.remove();
}

// Window message receiver
window.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "VELOSIA_DRAFT_CREATED") {
    closeCameraOverlay();
    closeOverlay();
    chrome.storage.local.get("velosia_backend_url", (data) => {
      if (data.velosia_backend_url) {
        backendUrl = data.velosia_backend_url;
      }
      if (event.data.draft) {
        autofillForm(event.data.draft);
      }
    });
  } else if (event.data.type === "VELOSIA_CLOSE_CAMERA") {
    closeCameraOverlay();
  }
});

// Initialize
function init() {
  injectFloatingButton();
  checkPendingAutofill();
}

// Small helper for authenticated GET requests.
function fetchJson(url, token) {
  return fetch(url, { headers: { "Authorization": `Bearer ${token}` } })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
}

// When the popup queued "open platform + autofill this draft", the listing page
// loads with a pending entry in storage. Pick it up and run the engine. On the
// Kleinanzeigen two-step flow this fires again after the step-2 reload.
function checkPendingAutofill() {
  chrome.storage.local.get(
    ["velosia_pending_autofill", "velosia_token", "velosia_backend_url"],
    async (data) => {
      const pending = data.velosia_pending_autofill;
      const token = data.velosia_token;
      if (!pending || !token) return;
      if (data.velosia_backend_url) backendUrl = data.velosia_backend_url;

      const host = window.location.hostname;
      if (pending.platform === "vinted" && !host.includes("vinted")) return;
      if (pending.platform === "kleinanzeigen" && !host.includes("kleinanzeigen")) return;

      const settings = await fetchJson(`${backendUrl}/api/auth/me`, token);
      if (settings) window.velosiaUserSettings = settings;

      const draft = await fetchJson(`${backendUrl}/api/drafts/${pending.draftId}`, token);
      if (!draft) return;

      const autoSubmit = (typeof pending.autoSubmit === "boolean")
        ? pending.autoSubmit
        : !!(settings && settings.auto_submit);

      autofillForm(draft, autoSubmit);

      // Only clear the queue once we are on the real form, so the Kleinanzeigen
      // category step (step 1) -> form (step 2) reload still finds the draft.
      const phase = window.__velosia.detectPhase(pending.platform);
      if (phase === "form") {
        chrome.storage.local.remove("velosia_pending_autofill");
      }
    }
  );
}

// Inject the Velosia floating button on the page
function injectFloatingButton() {
  if (document.getElementById("velosia-floating-btn")) return;

  const btn = document.createElement("div");
  btn.id = "velosia-floating-btn";
  btn.innerHTML = "✨ Velosia";
  
  // Style
  Object.assign(btn.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    backgroundColor: "#09b0b7",
    color: "#000000",
    padding: "12px 20px",
    borderRadius: "99px",
    fontFamily: "'Outfit', 'Inter', sans-serif",
    fontWeight: "bold",
    fontSize: "14px",
    boxShadow: "0 4px 16px rgba(9, 176, 183, 0.4)",
    cursor: "pointer",
    zIndex: "999999",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    transition: "all 0.2s ease",
    userSelect: "none"
  });

  btn.addEventListener("mouseenter", () => {
    btn.style.transform = "scale(1.05)";
    btn.style.backgroundColor = "#078e94";
  });
  btn.addEventListener("mouseleave", () => {
    btn.style.transform = "scale(1)";
    btn.style.backgroundColor = "#09b0b7";
  });

  btn.addEventListener("click", toggleOverlay);
  document.body.appendChild(btn);
}

// Toggle Drafts Drawer Overlay
async function toggleOverlay() {
  if (isOverlayOpen) {
    closeOverlay();
  } else {
    await openOverlay();
  }
}

function closeOverlay() {
  const overlay = document.getElementById("velosia-drawer");
  if (overlay) overlay.remove();
  isOverlayOpen = false;
}

async function openOverlay() {
  isOverlayOpen = true;
  
  // Create drawer
  const drawer = document.createElement("div");
  drawer.id = "velosia-drawer";
  
  // Styling
  Object.assign(drawer.style, {
    position: "fixed",
    top: "0",
    right: "0",
    width: "350px",
    height: "100vh",
    backgroundColor: "#0e121a",
    color: "#f8fafc",
    boxShadow: "-4px 0 24px rgba(0,0,0,0.5)",
    borderLeft: "1px solid rgba(255,255,255,0.08)",
    zIndex: "999998",
    padding: "20px",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    transition: "transform 0.3s ease"
  });

  // Header HTML
  let contentHtml = `
    <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid rgba(255,255,255,0.08); padding-bottom:12px; margin-bottom:16px;">
      <span style="font-size:18px; font-weight:bold; background:linear-gradient(135deg, #09b0b7 0%, #ec4899 100%); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">✨ Velosia Angebote</span>
      <button id="velosia-close" style="background:transparent; border:none; color:#94a3b8; cursor:pointer; font-size:18px;">&times;</button>
    </div>
    <button id="velosia-btn-camera" style="width:100%; padding:12px; background:linear-gradient(135deg, #09b0b7 0%, #ec4899 100%); border:none; border-radius:8px; color:#000000; font-weight:bold; font-size:13px; font-family:'Outfit', 'Inter', sans-serif; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:16px; box-shadow:0 4px 12px rgba(9, 176, 183, 0.2); transition:all 0.2s ease;">
      📸 Neues Foto aufnehmen
    </button>
    <div id="velosia-list-container" style="flex-grow:1; overflow-y:auto; display:flex; flexDirection:column; gap:12px; padding-bottom:20px;">
      <p style="color:#94a3b8; font-size:13px;">Lade Angebote...</p>
    </div>
  `;
  
  drawer.innerHTML = contentHtml;
  document.body.appendChild(drawer);

  // Close event listener
  document.getElementById("velosia-close").addEventListener("click", closeOverlay);

  // Camera event listener
  const camBtn = document.getElementById("velosia-btn-camera");
  camBtn.addEventListener("click", openCameraOverlay);
  camBtn.addEventListener("mouseenter", () => {
    camBtn.style.transform = "scale(1.02)";
  });
  camBtn.addEventListener("mouseleave", () => {
    camBtn.style.transform = "scale(1)";
  });

  // Fetch drafts from backend using token from extension storage
  chrome.storage.local.get(["velosia_token", "velosia_backend_url"], async (data) => {
    const token = data.velosia_token;
    if (data.velosia_backend_url) {
      backendUrl = data.velosia_backend_url;
    }
    
    if (!token) {
      document.getElementById("velosia-list-container").innerHTML = `
        <div style="color:#f59e0b; font-size:13px; background:rgba(245,158,11,0.1); padding:10px; border-radius:6px; border:1px solid rgba(245,158,11,0.2); line-height: 1.4;">
          Bitte melde dich zuerst über das Velosia-Erweiterungssymbol in deiner Browser-Leiste an.
        </div>
      `;
      return;
    }

    try {
      // Fetch user profile settings
      let userSettings = null;
      try {
        const userRes = await fetch(`${backendUrl}/api/auth/me`, {
          headers: {
            "Authorization": `Bearer ${token}`
          }
        });
        if (userRes.ok) {
          userSettings = await userRes.json();
        }
      } catch (userErr) {
        console.warn("Konnte User-Einstellungen nicht laden:", userErr);
      }
      window.velosiaUserSettings = userSettings;

      const response = await fetch(`${backendUrl}/api/drafts`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error();
      drafts = await response.json();
      renderDraftsList();
    } catch (err) {
      document.getElementById("velosia-list-container").innerHTML = `
        <div style="color:#fca5a5; font-size:13px; background:rgba(239,68,68,0.1); padding:10px; border-radius:6px; border:1px solid rgba(239,68,68,0.2); line-height: 1.4;">
          Fehler beim Laden der Angebote. Bitte stelle sicher, dass der Velosia Server läuft und deine Sitzung aktiv ist.
        </div>
      `;
    }
  });
}

// Render the list of drafts inside the drawer
function renderDraftsList() {
  const container = document.getElementById("velosia-list-container");
  if (!container) return;

  if (drafts.length === 0) {
    container.innerHTML = `<p style="color:#94a3b8; font-size:13px; text-align:center; margin-top:20px;">Keine Angebote vorhanden. Fotografiere erst ein Teil!</p>`;
    return;
  }

  container.innerHTML = "";
  drafts.forEach((draft) => {
    const card = document.createElement("div");
    card.style.cssText = `
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      padding: 10px;
      cursor: pointer;
      display: flex;
      gap: 10px;
      align-items: center;
      transition: all 0.2s ease;
    `;

    card.addEventListener("mouseenter", () => {
      card.style.background = "rgba(9, 176, 183, 0.05)";
      card.style.borderColor = "rgba(9, 176, 183, 0.3)";
    });
    card.addEventListener("mouseleave", () => {
      card.style.background = "rgba(255,255,255,0.02)";
      card.style.borderColor = "rgba(255,255,255,0.08)";
    });

    const imageUrl = draft.image_path.startsWith("http") ? draft.image_path : `${backendUrl}${draft.image_path}`;

    card.innerHTML = `
      <img src="${imageUrl}" style="width:50px; height:50px; object-fit:cover; border-radius:4px; background:#000;" />
      <div style="flex-grow:1; min-width:0;">
        <div style="font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#f8fafc;">${draft.title || 'Unbenannt'}</div>
        <div style="font-size:11px; color:#94a3b8; margin-top:2px;">${draft.category} • ${draft.condition}</div>
      </div>
      <div style="font-weight:bold; font-size:13px; color:#09b0b7; flex-shrink:0;">${Math.round(draft.price)}€</div>
    `;

    card.addEventListener("click", () => {
      autofillForm(draft);
      closeOverlay();
    });

    container.appendChild(card);
  });
}

// Perform Autofill by delegating to the shared Velosia engine (autofill-engine.js,
// loaded as a content script before this file). All the platform-specific field
// logic, the React-safe value setter, the photo upload and the feedback overlay
// live in the engine so the Android WebView shell can reuse the exact same code.
async function autofillForm(draft, autoSubmit) {
  if (!window.__velosia || !window.__velosia.autofill) {
    console.error("Velosia: Autofill-Engine nicht geladen.");
    return;
  }
  // Arm a capture marker: once the user publishes and lands on the public listing
  // page, capture.js reports the listing id back so the dashboard can track it.
  try {
    const platform = window.__velosia.detectPlatform();
    if (platform && draft && draft.id != null) {
      chrome.storage.local.set({
        velosia_pending_capture: { platform: platform, draftId: draft.id, ts: Date.now() }
      });
    }
  } catch (e) {}

  const settings = window.velosiaUserSettings || {};
  const submit = (typeof autoSubmit === "boolean") ? autoSubmit : !!settings.auto_submit;
  // Token for the engine's anonymous autofill telemetry (auto health monitoring).
  const token = await new Promise((resolve) =>
    chrome.storage.local.get(["velosia_token"], (d) => resolve((d && d.velosia_token) || ""))
  );
  try {
    await window.__velosia.autofill(draft, {
      backendUrl: backendUrl,
      token: token,
      userZip: settings.default_zip || "",
      userCity: settings.default_city || "",
      autoSubmit: submit,
      imageMode: "datatransfer",
      showOverlay: true
    });
  } catch (err) {
    console.error("Velosia: Autofill fehlgeschlagen:", err);
  }
}

// Run
init();
