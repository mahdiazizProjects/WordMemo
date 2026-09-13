// Native builds retain offline practice. The public browser release supplies the
// Amplify OAuth adapter via auth-api.web.ts; native deep links require a signed build.
import type { Account, AuthView } from './auth-types';
const view: AuthView = { ready: true, error: '' };
export const authSnapshot = () => view;
export const subscribeAuth = (_f: () => void) => () => {};
export const startAuth = async () => {};
export const login = async (_google = false) => { throw new Error('Open WordMemo in your browser to sign in and practise with your group.'); };
export const logout = async () => {};
export const accountToken = async (_account: Account): Promise<string> => { throw new Error('Sign-in is available in the browser app.'); };
export const pendingInvite = () => '';
export const clearInvite = () => {};
