import api from '../services/api';

/** Remove legacy token storage from older versions */
export function clearLegacyAuthToken() {
  localStorage.removeItem('token');
}

export async function verifySession() {
  try {
    const response = await api.get('/auth/session');
    return Boolean(response.data?.valid);
  } catch {
    return false;
  }
}

export async function logout() {
  clearLegacyAuthToken();
  try {
    await api.post('/auth/logout');
  } catch {
    // Cookie may already be cleared or expired
  }
  window.location.href = '/admin/login';
}
