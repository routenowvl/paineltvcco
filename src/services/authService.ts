
import { PublicClientApplication, Configuration, AuthenticationResult } from "@azure/msal-browser";

export type AuthMode = 'primary' | 'viewer';

const AUTH_MODE_STORAGE_KEY = 'cco_auth_mode';
const DEFAULT_SCOPES = ["User.Read", "Sites.ReadWrite.All"];

const parseScopes = (raw: string | undefined, fallback: string[] = DEFAULT_SCOPES): string[] => {
    const parsed = String(raw || '')
        .split(/[,\s;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    return parsed.length > 0 ? parsed : fallback;
};

const primaryClientId = String(import.meta.env.VITE_AZURE_CLIENT_ID || '').trim();
const primaryTenantId = String(import.meta.env.VITE_AZURE_TENANT_ID || '').trim();

if (!primaryClientId || !primaryTenantId) {
    throw new Error(
        '[AUTH] VITE_AZURE_CLIENT_ID e VITE_AZURE_TENANT_ID são obrigatórios. ' +
        'Configure as variáveis de ambiente antes de iniciar o app.'
    );
}

const primaryAuthority = `https://login.microsoftonline.com/${primaryTenantId}`;

const viewerClientId = String(import.meta.env.VITE_AZURE_VIEWER_CLIENT_ID || '').trim();
const viewerTenantId = String(import.meta.env.VITE_AZURE_VIEWER_TENANT_ID || primaryTenantId).trim();
const viewerAuthorityFromEnv = String(import.meta.env.VITE_AZURE_VIEWER_AUTHORITY || '').trim();
const viewerAuthority = viewerAuthorityFromEnv || `https://login.microsoftonline.com/${viewerTenantId}`;

const primaryScopes = parseScopes(import.meta.env.VITE_AZURE_SCOPES);
const viewerScopes = parseScopes(import.meta.env.VITE_AZURE_VIEWER_SCOPES, primaryScopes);

const createMsalConfig = (clientId: string, authority: string): Configuration => ({
    auth: {
        clientId,
        authority,
        redirectUri: window.location.origin,
    },
    cache: {
        cacheLocation: "sessionStorage",
        storeAuthStateInCookie: false,
    },
    system: {
        iframeHashTimeout: 6000,
        loggerOptions: {
            loggerCallback: (level, message, containsPii) => {
                if (!containsPii) {
                    switch (level) {
                        case 0: // Error
                            console.error('[MSAL]', message);
                            break;
                        case 1: // Warning
                        case 2: // Info
                        case 3: // Verbose
                            break;
                    }
                }
            },
            logLevel: 0, // Only errors
        },
    },
});

const primaryMsalInstance = new PublicClientApplication(createMsalConfig(primaryClientId, primaryAuthority));
const viewerMsalInstance = viewerClientId
    ? new PublicClientApplication(createMsalConfig(viewerClientId, viewerAuthority))
    : null;

export const isViewerAuthConfigured = (): boolean => Boolean(viewerMsalInstance);

export const getAuthMode = (): AuthMode => {
    const raw = (localStorage.getItem(AUTH_MODE_STORAGE_KEY) || '').trim().toLowerCase();
    if (raw === 'viewer' && isViewerAuthConfigured()) return 'viewer';
    return 'primary';
};

export const setAuthMode = (mode: AuthMode): AuthMode => {
    const nextMode: AuthMode = mode === 'viewer' && isViewerAuthConfigured() ? 'viewer' : 'primary';
    localStorage.setItem(AUTH_MODE_STORAGE_KEY, nextMode);
    return nextMode;
};

export const getMsalInstance = (mode?: AuthMode): PublicClientApplication => {
    const resolved = mode || getAuthMode();
    if (resolved === 'viewer' && viewerMsalInstance) return viewerMsalInstance;
    return primaryMsalInstance;
};

export const getAuthScopes = (mode?: AuthMode): string[] => {
    const resolved = mode || getAuthMode();
    if (resolved === 'viewer' && viewerMsalInstance) return viewerScopes;
    return primaryScopes;
};

export const msalInstance = primaryMsalInstance;

const getAccountByLoginHint = (
    instance: PublicClientApplication,
    loginHint?: string
) => {
    const accounts = instance.getAllAccounts();
    if (accounts.length === 0) return null;
    if (!loginHint) return accounts[0];
    return accounts.find((acc) => acc.username?.toLowerCase() === loginHint.toLowerCase()) || accounts[0];
};

type EnsureSessionOptions = {
    interactive?: boolean;
};

export const ensurePrimaryAuthSession = async (
    loginHint?: string,
    options?: EnsureSessionOptions
): Promise<string | null> => {
    const interactive = options?.interactive !== false;
    const instance = getMsalInstance('primary');
    const scopes = getAuthScopes('primary');

    await instance.initialize();

    const existingAccount = getAccountByLoginHint(instance, loginHint);
    if (existingAccount) {
        try {
            const silent = await instance.acquireTokenSilent({ scopes, account: existingAccount });
            setAuthMode('primary');
            return silent.accessToken;
        } catch {
            // segue para SSO/popup
        }
    }

    try {
        const sso = await instance.ssoSilent({ scopes, loginHint });
        setAuthMode('primary');
        return sso.accessToken;
    } catch {
        // fallback interativo
    }

    if (!interactive) {
        return null;
    }

    try {
        const popup = await instance.acquireTokenPopup({ scopes, prompt: 'select_account', loginHint });
        setAuthMode('primary');
        return popup.accessToken;
    } catch (err) {
        console.error('[AUTH] Falha ao estabelecer sessão principal:', (err as any)?.message || err);
        return null;
    }
};

export const resolveLoginResponseForCurrentMode = async (): Promise<AuthenticationResult | null> => {
    const mode = getAuthMode();
    const instance = getMsalInstance(mode);
    await instance.initialize();
    return instance.handleRedirectPromise();
};

export const logout = async () => {
    try {
        const mode = getAuthMode();
        const instance = getMsalInstance(mode);
        const accounts = instance.getAllAccounts();

        localStorage.setItem('msal_manual_logout', 'true');
        localStorage.removeItem(AUTH_MODE_STORAGE_KEY);

        if (accounts.length > 0) {
            await instance.logoutRedirect({
                account: accounts[0],
                postLogoutRedirectUri: window.location.origin,
            });
        } else {
            localStorage.clear();
            sessionStorage.clear();
            window.location.reload();
        }
    } catch (e) {
        console.error("Erro durante o logout:", e);
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload();
    }
};
