const TOKEN_KEY = 'auth_token';

/** Remove legacy token storage from older versions */
export function clearLegacyAuthToken() {
  localStorage.removeItem('token');
}

export function setAuthToken(token, rememberMe = false) {
  clearAuthToken();
  if (!token) return;

  if (rememberMe) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    sessionStorage.setItem(TOKEN_KEY, token);
  }
}

export function getAuthToken() {
  return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
}

export function clearAuthToken() {
  sessionStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(TOKEN_KEY);
  clearLegacyAuthToken();
}
