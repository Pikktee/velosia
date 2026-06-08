// Vintamie Form Autofiller Content Script
console.log("Vintamie Content Script geladen!");

// State
let drafts = [];
let isOverlayOpen = false;
let backendUrl = "https://api.vintamie.henrikheil.net"; // Default to production

function openCameraOverlay() {
  if (document.getElementById("vintamie-camera-iframe")) return;

  const iframe = document.createElement("iframe");
  iframe.id = "vintamie-camera-iframe";
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
  const iframe = document.getElementById("vintamie-camera-iframe");
  if (iframe) iframe.remove();
}

// Window message receiver
window.addEventListener("message", (event) => {
  if (!event.data) return;

  if (event.data.type === "VINTAMIE_DRAFT_CREATED") {
    closeCameraOverlay();
    closeOverlay();
    chrome.storage.local.get("vintamie_backend_url", (data) => {
      if (data.vintamie_backend_url) {
        backendUrl = data.vintamie_backend_url;
      }
      if (event.data.draft) {
        autofillForm(event.data.draft);
      }
    });
  } else if (event.data.type === "VINTAMIE_CLOSE_CAMERA") {
    closeCameraOverlay();
  }
});

// Initialize
function init() {
  injectFloatingButton();
}

// Inject the Vintamie floating button on the page
function injectFloatingButton() {
  if (document.getElementById("vintamie-floating-btn")) return;

  const btn = document.createElement("div");
  btn.id = "vintamie-floating-btn";
  btn.innerHTML = "✨ Vintamie";
  
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
  const overlay = document.getElementById("vintamie-drawer");
  if (overlay) overlay.remove();
  isOverlayOpen = false;
}

async function openOverlay() {
  isOverlayOpen = true;
  
  // Create drawer
  const drawer = document.createElement("div");
  drawer.id = "vintamie-drawer";
  
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
      <span style="font-size:18px; font-weight:bold; background:linear-gradient(135deg, #09b0b7 0%, #ec4899 100%); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">✨ Vintamie Entwürfe</span>
      <button id="vintamie-close" style="background:transparent; border:none; color:#94a3b8; cursor:pointer; font-size:18px;">&times;</button>
    </div>
    <button id="vintamie-btn-camera" style="width:100%; padding:12px; background:linear-gradient(135deg, #09b0b7 0%, #ec4899 100%); border:none; border-radius:8px; color:#000000; font-weight:bold; font-size:13px; font-family:'Outfit', 'Inter', sans-serif; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:8px; margin-bottom:16px; box-shadow:0 4px 12px rgba(9, 176, 183, 0.2); transition:all 0.2s ease;">
      📸 Neues Foto aufnehmen
    </button>
    <div id="vintamie-list-container" style="flex-grow:1; overflow-y:auto; display:flex; flexDirection:column; gap:12px; padding-bottom:20px;">
      <p style="color:#94a3b8; font-size:13px;">Lade Entwürfe...</p>
    </div>
  `;
  
  drawer.innerHTML = contentHtml;
  document.body.appendChild(drawer);

  // Close event listener
  document.getElementById("vintamie-close").addEventListener("click", closeOverlay);

  // Camera event listener
  const camBtn = document.getElementById("vintamie-btn-camera");
  camBtn.addEventListener("click", openCameraOverlay);
  camBtn.addEventListener("mouseenter", () => {
    camBtn.style.transform = "scale(1.02)";
  });
  camBtn.addEventListener("mouseleave", () => {
    camBtn.style.transform = "scale(1)";
  });

  // Fetch drafts from backend using token from extension storage
  chrome.storage.local.get(["vintamie_token", "vintamie_backend_url"], async (data) => {
    const token = data.vintamie_token;
    if (data.vintamie_backend_url) {
      backendUrl = data.vintamie_backend_url;
    }
    
    if (!token) {
      document.getElementById("vintamie-list-container").innerHTML = `
        <div style="color:#f59e0b; font-size:13px; background:rgba(245,158,11,0.1); padding:10px; border-radius:6px; border:1px solid rgba(245,158,11,0.2); line-height: 1.4;">
          Bitte melde dich zuerst über das Vintamie-Erweiterungssymbol in deiner Browser-Leiste an.
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
      window.vintamieUserSettings = userSettings;

      const response = await fetch(`${backendUrl}/api/drafts`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error();
      drafts = await response.json();
      renderDraftsList();
    } catch (err) {
      document.getElementById("vintamie-list-container").innerHTML = `
        <div style="color:#fca5a5; font-size:13px; background:rgba(239,68,68,0.1); padding:10px; border-radius:6px; border:1px solid rgba(239,68,68,0.2); line-height: 1.4;">
          Fehler beim Laden der Entwürfe. Bitte stelle sicher, dass der Vintamie Server läuft und deine Sitzung aktiv ist.
        </div>
      `;
    }
  });
}

// Render the list of drafts inside the drawer
function renderDraftsList() {
  const container = document.getElementById("vintamie-list-container");
  if (!container) return;

  if (drafts.length === 0) {
    container.innerHTML = `<p style="color:#94a3b8; font-size:13px; text-align:center; margin-top:20px;">Keine Entwürfe vorhanden. Fotografiere erst ein Teil!</p>`;
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

// Perform Autofill logic on the host page form
async function autofillForm(draft) {
  const host = window.location.hostname;
  
  if (host.includes("kleinanzeigen")) {
    fillKleinanzeigen(draft);
  } else if (host.includes("vinted")) {
    fillVinted(draft);
  }
}

// Kleinanzeigen Autofill Logic
async function fillKleinanzeigen(draft) {
  // Title selector
  const titleInput = document.querySelector("#postad-title") || document.querySelector("input[name='title']") || document.querySelector("input[id*='title']");
  if (titleInput) {
    titleInput.value = draft.title;
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Description selector
  const descTextarea = document.querySelector("#pstad-descrptn") || document.querySelector("textarea[name='description']") || document.querySelector("textarea[id*='descr']");
  if (descTextarea) {
    descTextarea.value = draft.description;
    descTextarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Price selector
  const priceInput = document.querySelector("#pstad-price") || document.querySelector("input[name='price']") || document.querySelector("input[id*='price']");
  if (priceInput) {
    priceInput.value = Math.round(draft.price);
    priceInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Set price type to Festpreis (Usually the first radio button in the group)
  const priceRadios = document.querySelectorAll("input[name='priceType']");
  if (priceRadios && priceRadios.length > 0) {
    // Select Festpreis (commonly value "FIXED")
    for (let radio of priceRadios) {
      if (radio.value === "FIXED" || radio.id.includes("fixed") || radio.id.includes("fest")) {
        radio.checked = true;
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        break;
      }
    }
  }

  // Autofill Zip code (Postleitzahl) if configured in settings
  const userSettings = window.vintamieUserSettings || {};
  if (userSettings.default_zip) {
    const postcodeInput = document.querySelector("#postad-postcode") || document.querySelector("input[name='postcode']") || document.querySelector("input[id*='postcode']") || document.querySelector("input[placeholder*='PLZ']");
    if (postcodeInput) {
      postcodeInput.value = userSettings.default_zip;
      postcodeInput.dispatchEvent(new Event('input', { bubbles: true }));
      postcodeInput.dispatchEvent(new Event('change', { bubbles: true }));
      postcodeInput.dispatchEvent(new Event('blur', { bubbles: true })); // Trigger blur to resolve city in Kleinanzeigen
    }
  }

  // Image upload
  if (draft.image_path) {
    uploadImage(draft.image_path);
  }
}

// Vinted Autofill Logic
async function fillVinted(draft) {
  // Title
  const titleInput = document.querySelector("input[name='title']") || document.querySelector("input[placeholder*='titel']") || document.querySelector("input[id*='title']");
  if (titleInput) {
    titleInput.value = draft.title;
    titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Description
  const descTextarea = document.querySelector("textarea[name='description']") || document.querySelector("textarea[placeholder*='beschreib']") || document.querySelector("textarea[id*='desc']");
  if (descTextarea) {
    descTextarea.value = draft.description;
    descTextarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Price
  const priceInput = document.querySelector("input[name='price']") || document.querySelector("input[placeholder*='0,00']") || document.querySelector("input[id*='price']");
  if (priceInput) {
    priceInput.value = Math.round(draft.price);
    priceInput.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Image upload
  if (draft.image_path) {
    uploadImage(draft.image_path);
  }
}

// Universal programmatical Image Upload function
async function uploadImage(imagePath) {
  try {
    const imageUrl = imagePath.startsWith("http") ? imagePath : `${backendUrl}${imagePath}`;
    
    // Fetch image as blob
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    
    // Create File object
    const file = new File([blob], "vintamie_artikel.jpg", { type: "image/jpeg" });
    
    // Find file inputs
    const fileInputs = document.querySelectorAll("input[type='file']");
    if (fileInputs.length === 0) {
      console.warn("Vintamie: Kein File-Input Element gefunden.");
      return;
    }

    // Try to find the primary image file input
    // Usually on Vinted/Kleinanzeigen, we can target the first visible file input
    let targetInput = null;
    for (let input of fileInputs) {
      if (input.style.display !== "none" || input.id || input.name || input.className) {
        targetInput = input;
        break;
      }
    }
    
    if (!targetInput) targetInput = fileInputs[0];

    // Assign file via DataTransfer
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    targetInput.files = dataTransfer.files;
    
    // Trigger change event to kick off host page upload handlers
    targetInput.dispatchEvent(new Event("change", { bubbles: true }));
    console.log("Vintamie: Bild erfolgreich in den File-Input injiziert!");
  } catch (err) {
    console.error("Vintamie: Bild-Injektion fehlgeschlagen:", err);
  }
}

// Run
init();
