import api from '../services/api';
import { clearAuthToken } from './authToken';

export { setAuthToken, getAuthToken, clearAuthToken, clearLegacyAuthToken } from './authToken';

export async function verifySession() {
  try {
    const response = await api.get('/auth/session');
    return Boolean(response.data?.valid);
  } catch {
    return false;
  }
}

export async function logout() {
  clearAuthToken();
  try {
    await api.post('/auth/logout');
  } catch {
    // Cookie may already be cleared or expired
  }
  window.location.href = '/admin/login';
}
