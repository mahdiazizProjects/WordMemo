import { Amplify } from 'aws-amplify';
import { fetchAuthSession, getCurrentUser, signInWithRedirect, signOut } from 'aws-amplify/auth';
import { cognitoUserPoolsTokenProvider } from 'aws-amplify/auth/cognito';
import { Hub, sessionStorage } from 'aws-amplify/utils';
import 'aws-amplify/auth/enable-oauth-listener';
import type { Account, AuthConfig, AuthView } from './auth-types';

let view: AuthView = { ready: false, error: '' };
let started: Promise<void> | undefined;
const listeners = new Set<() => void>();
const emit = (patch: Partial<AuthView>) => { view = { ...view, ...patch }; for (const f of listeners) f(); };
export const authSnapshot = () => view;
export const subscribeAuth = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
async function refreshAccount() {
  if (!view.config?.enabled) return;
  try {
    const user = await getCurrentUser();
    const session = await fetchAuthSession();
    if (session.tokens?.accessToken.payload.sub !== user.userId) throw new Error('Session changed');
    emit({ ready: true, error: '', account: { id: user.userId, email: String(session.tokens?.idToken?.payload.email ?? 'Your account'), config: view.config } });
  } catch { emit({ ready: true, account: undefined }); }
}
export function startAuth(): Promise<void> {
  if (started) return started;
  started = (async () => {
    try {
      // Preserve invitation through the Cognito/Google redirect, never in its state parameter.
      if (/^#join=[A-Za-z0-9_-]{24,80}$/.test(location.hash)) window.sessionStorage.setItem('wordmemo.invite', location.hash.slice(6));
      const response = await fetch('/wordmemo-config.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error('Account services could not be reached. You can continue on this device.');
      const config = await response.json() as AuthConfig;
      if (!config.enabled) { emit({ ready: true, config }); return; }
      if (!/^[a-z]{2}-[a-z]+-\d$/.test(config.region) || !config.userPoolId.startsWith(config.region + '_') || !/^[a-z0-9]+$/.test(config.clientId)
        || !new RegExp('^https://[a-z0-9]+\\.execute-api\\.' + config.region.replaceAll('-', '\\-') + '\\.amazonaws\\.com/?$').test(config.apiUrl)
        || !config.domain.endsWith(`.auth.${config.region}.amazoncognito.com`) || new URL(config.appUrl).origin !== location.origin) throw new Error('Account setup is unavailable. You can continue on this device.');
      cognitoUserPoolsTokenProvider.setKeyValueStorage(sessionStorage);
      Hub.listen('auth', ({ payload }) => {
        if (['signedIn', 'signInWithRedirect', 'tokenRefresh'].includes(payload.event)) void refreshAccount();
        if (payload.event === 'signedOut') emit({ account: undefined, ready: true });
        if (payload.event === 'signInWithRedirect_failure') emit({ ready: true, error: 'Sign-in did not finish. Please try again.' });
      });
      emit({ config });
      Amplify.configure({ Auth: { Cognito: { userPoolId: config.userPoolId, userPoolClientId: config.clientId,
        loginWith: { oauth: { domain: config.domain, scopes: ['openid', 'email', 'profile', 'aws.cognito.signin.user.admin'],
          redirectSignIn: [config.appUrl], redirectSignOut: [config.appUrl], responseType: 'code', providers: config.googleEnabled ? ['Google'] : [] } } } } });
      await refreshAccount();
    } catch (e) { emit({ ready: true, error: e instanceof Error ? e.message : 'Sign-in is temporarily unavailable.' }); }
  })();
  return started;
}
export async function login(google = false) {
  if (!view.config?.enabled) throw new Error('Account saving will be available after the AWS upgrade is deployed.');
  if (google && !view.config.googleEnabled) throw new Error('Google sign-in is not connected yet.');
  await signInWithRedirect(google ? { provider: 'Google' } : undefined);
}
export async function logout() { await signOut(); emit({ account: undefined }); }
export async function accountToken(account: Account): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken;
  if (!token || token.payload.sub !== account.id) throw Object.assign(new Error('Sign in again to continue.'), { status: 401 });
  return token.toString();
}
export function pendingInvite() { return window.sessionStorage.getItem('wordmemo.invite') ?? ''; }
export function clearInvite() { window.sessionStorage.removeItem('wordmemo.invite'); if (location.hash.startsWith('#join=')) history.replaceState(null, '', location.pathname); }
