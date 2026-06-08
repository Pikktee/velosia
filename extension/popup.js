let backendUrl = "https://api.vintamie.henrikheil.net"; // Default to production

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
  chrome.storage.local.get(["vintamie_token", "vintamie_user_email", "vintamie_backend_url"], async (result) => {
    // Determine initially selected backend URL
    if (result.vintamie_backend_url) {
      backendUrl = result.vintamie_backend_url;
      envSelect.value = backendUrl.includes("localhost") ? "local" : "production";
    } else {
      backendUrl = "https://api.vintamie.henrikheil.net";
      envSelect.value = "production";
      chrome.storage.local.set({ "vintamie_backend_url": backendUrl });
    }

    updateDashboardLink();

    const token = result.vintamie_token;
    if (token) {
      validateToken(token, result.vintamie_user_email);
    } else {
      showLogin();
    }
  });

  // Handle environment change
  envSelect.addEventListener("change", () => {
    const selected = envSelect.value;
    backendUrl = selected === "local" ? "http://localhost:8000" : "https://api.vintamie.henrikheil.net";
    
    updateDashboardLink();

    chrome.storage.local.set({ "vintamie_backend_url": backendUrl }, () => {
      // Re-validate token under new environment
      chrome.storage.local.get(["vintamie_token", "vintamie_user_email"], (result) => {
        const token = result.vintamie_token;
        if (token) {
          validateToken(token, result.vintamie_user_email);
        } else {
          showLogin();
        }
      });
    });
  });

  // Update dashboard link dynamically
  function updateDashboardLink() {
    if (dashboardBtn) {
      dashboardBtn.href = backendUrl.includes("localhost") ? "http://localhost:5173" : "https://vintamie.henrikheil.net";
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
        "vintamie_token": token,
        "vintamie_user_email": email
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
    chrome.storage.local.remove(["vintamie_token", "vintamie_user_email"], () => {
      showLogin();
    });
  });

  function showConnected(email) {
    statusBadge.textContent = "Verbunden";
    statusBadge.className = "status-badge connected";
    loginView.style.display = "none";
    connectedView.style.display = "block";
    userEmailSpan.textContent = email;
  }

  function showLogin() {
    statusBadge.textContent = "Nicht angemeldet";
    statusBadge.className = "status-badge disconnected";
    loginView.style.display = "block";
    connectedView.style.display = "none";
    userEmailSpan.textContent = "";
  }
});
