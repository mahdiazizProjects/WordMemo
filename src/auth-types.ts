export type AuthConfig = { enabled: boolean; region: string; userPoolId: string; clientId: string; apiUrl: string; domain: string; googleEnabled: boolean; appUrl: string };
export type Account = { id: string; email: string; config: AuthConfig };
export type AuthView = { ready: boolean; config?: AuthConfig; account?: Account; error: string };
