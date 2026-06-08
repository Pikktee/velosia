// API utilities to communicate with the FastAPI backend with JWT Auth
const API_BASE_URL = import.meta.env.VITE_API_URL || (
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:8000'
    : `${window.location.protocol}//${window.location.hostname}:8000`
);

// Retrieve saved token
let authToken = localStorage.getItem('vintamie_token') || null;

export const setAuthToken = (token) => {
  authToken = token;
  if (token) {
    localStorage.setItem('vintamie_token', token);
  } else {
    localStorage.removeItem('vintamie_token');
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

// --- DRAFTS API (AUTHENTICATED) ---

export const uploadAndAnalyze = async (files) => {
  const formData = new FormData();
  if (Array.isArray(files)) {
    files.forEach(file => {
      formData.append('files', file);
    });
  } else {
    formData.append('files', files);
  }

  // For multipart/form-data, fetch determines the boundary automatically.
  // We pass null for Content-Type but still attach the Authorization header!
  const headers = getHeaders(null);

  const response = await fetch(`${API_BASE_URL}/api/upload`, {
    method: 'POST',
    headers: headers,
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.detail || 'Fehler beim Hochladen und Analysieren.');
  }

  return response.json();
};

export const getDrafts = async () => {
  const response = await fetch(`${API_BASE_URL}/api/drafts`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error('Fehler beim Laden der Entwürfe.');
  }
  return response.json();
};

export const getDraft = async (id) => {
  const response = await fetch(`${API_BASE_URL}/api/drafts/${id}`, {
    method: 'GET',
    headers: getHeaders(),
  });
  if (!response.ok) {
    throw new Error('Fehler beim Laden des Entwurfs.');
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
    throw new Error('Fehler beim Aktualisieren des Entwurfs.');
  }

  return response.json();
};

export const deleteDraft = async (id) => {
  const response = await fetch(`${API_BASE_URL}/api/drafts/${id}`, {
    method: 'DELETE',
    headers: getHeaders(),
  });

  if (!response.ok) {
    throw new Error('Fehler beim Löschen des Entwurfs.');
  }
  
  return true;
};
