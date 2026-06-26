// API utilities to communicate with the FastAPI backend with JWT Auth
export const API_BASE_URL = import.meta.env.VITE_API_URL || (
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : `${window.location.protocol}//${window.location.hostname}:8000`
);

// Retrieve saved token
let authToken = localStorage.getItem('velosia_token') || null;

export const setAuthToken = (token) => {
  authToken = token;
  if (token) {
    localStorage.setItem('velosia_token', token);
  } else {
    localStorage.removeItem('velosia_token');
  }
};

export const getAuthToken = () => authToken;

export const isAuthenticated = () => !!authToken;

// Helper to construct authenticated headers
const getHeaders = (contentType = 'application/json') => {
  const headers = {};
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
};

export const getImageUrl = (path) => {
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return `${API_BASE_URL}${path}`;
};

// --- AUTH API ---

export const registerUser = async (email, password) => {
  const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || 'Registrierung fehlgeschlagen.');
  }

  return response.json();
};

// Public tester-waitlist sign-up (no auth required).
export const joinWaitlist = async (email, note) => {
  const response = await fetch(`${API_BASE_URL}/api/waitlist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, note: note || null }),
  });

  if (!response.ok) {
    let detail = 'Anmeldung fehlgeschlagen.';
    try {
      const errorData = await response.json();
      if (errorData.detail) detail = typeof errorData.detail === 'string' ? errorData.detail : detail;
    } catch (_) { /* ignore non-JSON error bodies */ }
    throw new Error(detail);
  }

  return response.json();
};

export const loginUser = async (email, password) => {
  const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || 'Login fehlgeschlagen. E-Mail oder Passwort falsch.');
  }

  const data = await response.json();
  setAuthToken(data.access_token);
  return data;
};

export const getAuthConfig = async () => {
  const response = await fetch(`${API_BASE_URL}/api/auth/config`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    throw new Error('Fehler beim Laden der Server-Konfiguration.');
  }

  return response.json();
};

export const loginWithGoogle = async (credential) => {
  const response = await fetch(`${API_BASE_URL}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ credential }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || 'Google-Login-Validierung fehlgeschlagen.');
  }

  const data = await response.json();
  setAuthToken(data.access_token);
  return data;
};

export const getMe = async () => {
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error('Sitzung abgelaufen.');
  }

  return response.json();
};

export const updateMe = async (settingsData) => {
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(settingsData),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || 'Fehler beim Aktualisieren des Profils.');
  }

  return response.json();
};

// --- DRAFTS API (AUTHENTICATED) ---

export const uploadAndAnalyze = async (files, condition, details, signal) => {
  const formData = new FormData();
  if (Array.isArray(files)) {
    files.forEach(file => {
      formData.append('files', file);
    });
  } else {
    formData.append('files', files);
  }
  if (condition) {
    formData.append('condition', condition);
  }
  if (details) {
    formData.append('details', details);
  }

  // For multipart/form-data, fetch determines the boundary automatically.
  // We pass null for Content-Type but still attach the Authorization header!
  const headers = getHeaders(null);

  const response = await fetch(`${API_BASE_URL}/api/upload`, {
    method: 'POST',
    headers: headers,
    body: formData,
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || 'Fehler beim Hochladen und Analysieren.');
  }

  return response.json();
};

// Turbo mode: upload many photos at once, the backend groups them by item
// and returns an ARRAY of auto-created drafts (one per detected offer).
export const uploadTurbo = async (files, signal) => {
  const formData = new FormData();
  if (Array.isArray(files)) {
    files.forEach(file => formData.append('files', file));
  } else {
    formData.append('files', files);
  }

  // For multipart/form-data, fetch sets the boundary itself (Content-Type null),
  // but we still need the Authorization header.
  const headers = getHeaders(null);

  const response = await fetch(`${API_BASE_URL}/api/upload/turbo`, {
    method: 'POST',
    headers: headers,
    body: formData,
    signal,
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || 'Fehler beim Turbo-Upload.');
  }

  return response.json();
};

export const getDrafts = async () => {
  const response = await fetch(`${API_BASE_URL}/api/drafts`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error('Fehler beim Laden der Angebote.');
  }
  return response.json();
};

export const getDraft = async (id) => {
  const response = await fetch(`${API_BASE_URL}/api/drafts/${id}`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error('Fehler beim Laden des Angebots.');
  }
  return response.json();
};

export const updateDraft = async (id, draftData) => {
  const response = await fetch(`${API_BASE_URL}/api/drafts/${id}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(draftData),
  });

  if (!response.ok) {
    throw new Error('Fehler beim Aktualisieren des Angebots.');
  }

  return response.json();
};

export const deleteDraft = async (id) => {
  const response = await fetch(`${API_BASE_URL}/api/drafts/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error('Fehler beim Löschen des Angebots.');
  }
  
  return true;
};

export const deleteUserAccount = async () => {
  const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
    method: 'DELETE',
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error('Fehler beim Löschen des Accounts.');
  }

  return true;
};

export const uploadDraftImages = async (id, files) => {
  const formData = new FormData();
  if (Array.isArray(files)) {
    files.forEach(file => {
      formData.append('files', file);
    });
  } else {
    formData.append('files', files);
  }

  const headers = getHeaders(null);
  const response = await fetch(`${API_BASE_URL}/api/drafts/${id}/images`, {
    method: 'POST',
    headers: headers,
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || 'Fehler beim Hinzufügen der Bilder.');
  }

  return response.json();
};

export const deleteDraftImage = async (id, imagePath) => {
  const response = await fetch(`${API_BASE_URL}/api/drafts/${id}/images?image_path=${encodeURIComponent(imagePath)}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || 'Fehler beim Löschen des Bildes.');
  }

  return response.json();
};

// --- LISTING STATUS TRACKING ---

// Re-poll one draft's published listings (Kleinanzeigen / Vinted) and return the
// updated draft with fresh ka_status / vinted_status.
export const refreshListingStatus = async (id) => {
  const response = await fetch(`${API_BASE_URL}/api/listings/${id}/refresh-status`, {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error('Fehler beim Aktualisieren des Angebots-Status.');
  }
  return response.json();
};

// Manually set a platform's listing status (e.g. mark a Kleinanzeigen ad as sold,
// or record a 'geloescht' after a semi-manual cross-platform take-down).
export const setListingStatus = async (id, platform, status) => {
  const response = await fetch(`${API_BASE_URL}/api/listings/${id}/set-status`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ platform, status }),
  });
  if (!response.ok) {
    throw new Error('Status konnte nicht gesetzt werden.');
  }
  return response.json();
};

// Re-poll all of the user's active listings at once. Returns the full draft list.
export const refreshAllListings = async () => {
  const response = await fetch(`${API_BASE_URL}/api/listings/refresh-all`, {
    method: 'POST',
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error('Fehler beim Aktualisieren der Angebots-Status.');
  }
  return response.json();
};

export const regenerateDraftField = async (id, field) => {
  const response = await fetch(`${API_BASE_URL}/api/drafts/${id}/regenerate`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ field }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || 'Fehler bei der KI-Regeneration.');
  }

  return response.json();
};

// --- BUG REPORTS API ---

export const submitBugReport = async (bugData) => {
  const response = await fetch(`${API_BASE_URL}/api/bugs`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(bugData),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || 'Fehler beim Senden des Bug Reports.');
  }

  return response.json();
};

export const getBugReports = async () => {
  const response = await fetch(`${API_BASE_URL}/api/bugs`, {
    method: 'GET',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || 'Fehler beim Laden der Bug Reports.');
  }

  return response.json();
};

export const deleteBugReport = async (id) => {
  const response = await fetch(`${API_BASE_URL}/api/bugs/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || 'Fehler beim Löschen des Bug Reports.');
  }

  return true;
};

// --- ADMIN API ---

export const getWaitlist = async () => {
  const response = await fetch(`${API_BASE_URL}/api/waitlist`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Fehler beim Laden der Warteliste.');
  }
  return response.json();
};

export const getAdminUsers = async () => {
  const response = await fetch(`${API_BASE_URL}/api/admin/users`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Fehler beim Laden der Benutzer.');
  }
  return response.json();
};

export const setUserBlocked = async (id, blocked) => {
  const response = await fetch(`${API_BASE_URL}/api/admin/users/${id}/block`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({ blocked }),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Aktion fehlgeschlagen.');
  }
  return response.json();
};

export const deleteUser = async (id) => {
  const response = await fetch(`${API_BASE_URL}/api/admin/users/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Benutzer konnte nicht gelöscht werden.');
  }
  return true;
};

