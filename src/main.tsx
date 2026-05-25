import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { msalInstance, ensurePrimaryAuthSession, resolveLoginResponseForCurrentMode } from './services/authService';
import { startTokenRefreshLoop, stopTokenRefreshLoop } from './services/tokenService';
import { Dashboard } from './Dashboard';

async function bootstrap() {
    await msalInstance.initialize();

    await resolveLoginResponseForCurrentMode();

    const token = await ensurePrimaryAuthSession(undefined, { interactive: true });
    if (!token) {
        console.error('[BOOT] Não foi possível estabelecer sessão de autenticação.');
        document.getElementById('root')!.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#073551;color:#f0f6ff;font-family:sans-serif;flex-direction:column;gap:16px;">
                <h2>Falha na autenticação</h2>
                <button onclick="location.reload()" style="padding:10px 24px;font-size:16px;border-radius:8px;border:none;cursor:pointer;background:#1d8cf5;color:#fff;">Tentar novamente</button>
            </div>
        `;
        return;
    }

    console.log('[BOOT] Sessão estabelecida com sucesso');

    const cleanupRefresh = startTokenRefreshLoop(() => {
        console.warn('[BOOT] Sessão expirada — recarregando...');
        stopTokenRefreshLoop();
        window.location.reload();
    });

    window.addEventListener('token-expired', () => {
        console.warn('[BOOT] Evento token-expired recebido');
    });

    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <Dashboard />
        </StrictMode>
    );
}

void bootstrap();
