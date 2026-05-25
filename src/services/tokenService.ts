import { getAuthScopes, getMsalInstance } from './authService';
import { InteractionRequiredAuthError } from '@azure/msal-browser';

const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

let activeRefreshPromise: Promise<string> | null = null;
let refreshIntervalId: ReturnType<typeof setInterval> | null = null;

export const getValidToken = async (): Promise<string | null> => {
    if (activeRefreshPromise) {
        try {
            return await activeRefreshPromise;
        } catch {
            return null;
        }
    }

    try {
        const msalInstance = getMsalInstance();
        const scopes = getAuthScopes();
        const accounts = msalInstance.getAllAccounts();
        if (accounts.length === 0) {
            console.warn('[TOKEN] Nenhuma conta ativa no MSAL');
            return null;
        }

        const account = accounts[0];

        activeRefreshPromise = msalInstance
            .acquireTokenSilent({ scopes, account })
            .then(response => {
                const token = response.accessToken;
                activeRefreshPromise = null;

                const expiresIn = response.expiresOn
                    ? Math.round((response.expiresOn.getTime() - Date.now()) / 1000 / 60)
                    : '?';
                console.log(`[TOKEN] Token válido — expira em ~${expiresIn} min`);
                return token;
            })
            .catch(async (err) => {
                activeRefreshPromise = null;

                if (err instanceof InteractionRequiredAuthError) {
                    console.warn('[TOKEN] Refresh silencioso requer interação');
                    try {
                        const forced = await msalInstance.acquireTokenSilent({
                            scopes,
                            account,
                            forceRefresh: true,
                        });
                        return forced.accessToken;
                    } catch {
                        console.error('[TOKEN] Não foi possível renovar silenciosamente');
                        window.dispatchEvent(new CustomEvent('token-expired'));
                        throw err;
                    }
                }

                console.error('[TOKEN] Erro no acquireTokenSilent:', err.message);
                throw err;
            });

        return await activeRefreshPromise;
    } catch {
        return null;
    }
};

export const getValidTokenOrThrow = async (): Promise<string> => {
    const token = await getValidToken();
    if (!token) throw new Error('Sessão expirada. Por favor, renove sua sessão.');
    return token;
};

export const startTokenRefreshLoop = (
    onSessionExpired: () => void
): (() => void) => {
    stopTokenRefreshLoop();

    const CHECK_INTERVAL_MS = 3 * 60 * 1000;

    const checkAndRefresh = async () => {
        try {
            const msalInstance = getMsalInstance();
            const scopes = getAuthScopes();
            const accounts = msalInstance.getAllAccounts();
            if (accounts.length === 0) return;

            const account = accounts[0];

            const response = await msalInstance.acquireTokenSilent({
                scopes,
                account,
            });

            if (response?.accessToken) {
                const expiresOn = response.expiresOn;
                const timeUntilExpiry = expiresOn
                    ? expiresOn.getTime() - Date.now()
                    : Infinity;

                if (timeUntilExpiry < REFRESH_THRESHOLD_MS) {
                    console.log('[TOKEN_LOOP] Token próximo de expirar — forçando renovação');
                    await msalInstance.acquireTokenSilent({
                        scopes,
                        account,
                        forceRefresh: true,
                    });
                    console.log('[TOKEN_LOOP] Token renovado proativamente');
                }
            }
        } catch (err: any) {
            if (err instanceof InteractionRequiredAuthError) {
                console.warn('[TOKEN_LOOP] Sessão expirada — requer interação');
                onSessionExpired();
            } else {
                console.warn('[TOKEN_LOOP] Erro temporário no refresh:', err.message);
            }
        }
    };

    const initialTimeout = setTimeout(checkAndRefresh, 30 * 1000);
    refreshIntervalId = setInterval(checkAndRefresh, CHECK_INTERVAL_MS);

    console.log('[TOKEN_LOOP] Loop de refresh iniciado (intervalo: 3 min)');

    return () => {
        clearTimeout(initialTimeout);
        stopTokenRefreshLoop();
    };
};

export const stopTokenRefreshLoop = () => {
    if (refreshIntervalId !== null) {
        clearInterval(refreshIntervalId);
        refreshIntervalId = null;
        console.log('[TOKEN_LOOP] Loop de refresh parado');
    }
};

export const clearTokenState = () => {
    activeRefreshPromise = null;
    stopTokenRefreshLoop();
};
