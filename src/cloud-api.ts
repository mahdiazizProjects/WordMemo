import { accountToken } from './auth-api';
import type { Account } from './auth-types';
import type { AppState } from './types';
import type { Cloud, RemoteSnapshot } from './learning-store';
export async function request<T>(account: Account, path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST'): Promise<T> {
  const token = await accountToken(account);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(account.config.apiUrl.replace(/\/$/, '') + path, { method, signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.message ?? (response.status === 401 ? 'Sign in again to continue.' : 'The request could not be completed. Please try again.')), { status: response.status });
    return result as T;
  } catch (e) {
    if ((e as { status?: number }).status) throw e;
    throw new Error('Waiting for a connection. Your personal practice changes are queued on this device.');
  } finally { clearTimeout(timer); }
}
export function accountCloud(account: Account): Cloud {
  return { get: () => request<RemoteSnapshot>(account, '/progress'), put: (state: AppState, revision: number) => request<RemoteSnapshot>(account, '/progress', { state, revision }, 'PUT') };
}
