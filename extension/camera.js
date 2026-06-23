// Velosia Inline Camera Script
let stream = null;
let backendUrl = "https://api.velosia.henrikheil.net"; // Default to production
let token = null;

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const btnShutter = document.getElementById("btn-shutter");
const fileInput = document.getElementById("file-input");
const btnClose = document.getElementById("btn-close");
const loader = document.getElementById("loader");
const loaderStatus = document.getElementById("loader-status");
const errorBanner = document.getElementById("error-banner");
const errorMessage = document.getElementById("error-message");
const btnErrorClose = document.getElementById("btn-error-close");

// Initialize configuration from extension storage
async function init() {
  chrome.storage.local.get(["velosia_token", "velosia_backend_url"], (result) => {
    token = result.velosia_token;
    if (result.velosia_backend_url) {
      backendUrl = result.velosia_backend_url;
    }
    
    if (!token) {
      showError("Bitte logge dich zuerst über das Velosia-Erweiterungssymbol in der Browser-Leiste ein.");
      // Disable shutter, but keep close active
      btnShutter.disabled = true;
      btnShutter.style.opacity = "0.5";
      return;
    }

    startCamera();
  });
}

// Start WebRTC Camera stream
async function startCamera() {
  try {
    // Attempt to request back camera first (environment)
    const constraints = {
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
  } catch (err) {
    console.warn("Rückkamera nicht verfügbar, versuche Standardkamera:", err);
    try {
      // Fallback to any camera
      stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      video.srcObject = stream;
    } catch (fallbackErr) {
      console.error("Kamerazugriff verweigert oder keine Kamera vorhanden:", fallbackErr);
      showError("Kamera konnte nicht gestartet werden. Bitte wähle ein Foto aus deiner Galerie.");
    }
  }
}

// Stop camera stream safely
function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
}

// Capture photo from video feed
function capturePhoto() {
  if (!video.srcObject) return;

  const width = video.videoWidth;
  const height = video.videoHeight;
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d");
  // Optional mirror effect if using front camera (we skip for standard back camera)
  context.drawImage(video, 0, 0, width, height);

  canvas.toBlob((blob) => {
    if (blob) {
      const file = new File([blob], "velosia_capture.jpg", { type: "image/jpeg" });
      uploadAndAnalyze(file);
    }
  }, "image/jpeg", 0.9);
}

// Upload file to Backend `/api/upload`
async function uploadAndAnalyze(file) {
  showLoader("Foto wird hochgeladen...");

  const formData = new FormData();
  formData.append("file", file);

  try {
    const uploadUrl = `${backendUrl}/api/upload`;
    loaderStatus.textContent = "KI analysiert Bild...";

    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`
      },
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `Upload-Fehler (${response.status})`);
    }

    const draft = await response.json();
    loaderStatus.textContent = "Erfolgreich analysiert!";
    
    // Notify parent page that the draft is created
    stopCamera();
    window.parent.postMessage({
      type: "VELOSIA_DRAFT_CREATED",
      draft: draft
    }, "*");

  } catch (err) {
    console.error("Upload fehlgeschlagen:", err);
    hideLoader();
    showError(`Analyse fehlgeschlagen: ${err.message || 'Verbindung zum Server fehlgeschlagen.'}`);
  }
}

// Helper: Show/Hide Loader
function showLoader(message) {
  loaderStatus.textContent = message;
  loader.style.display = "flex";
}

function hideLoader() {
  loader.style.display = "none";
}

// Helper: Show Error Banner
function showError(message) {
  errorMessage.textContent = message;
  errorBanner.style.display = "flex";
}

// Close Camera (User Cancel)
function closeCamera() {
  stopCamera();
  window.parent.postMessage({ type: "VELOSIA_CLOSE_CAMERA" }, "*");
}

// Listeners
btnShutter.addEventListener("click", capturePhoto);

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) {
    uploadAndAnalyze(file);
  }
});

btnClose.addEventListener("click", closeCamera);

btnErrorClose.addEventListener("click", () => {
  errorBanner.style.display = "none";
});

// Start
init();
