import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { msalInstance, ensurePrimaryAuthSession, resolveLoginResponseForCurrentMode } from './services/authService';
import { startTokenRefreshLoop, stopTokenRefreshLoop } from './services/tokenService';
import { Dashboard } from './Dashboard';

async function bootstrap() {
    await msalInstance.initialize();

    await resolveLoginResponseForCurrentMode();

    createRoot(document.getElementById('root')!).render(
        <StrictMode>
            <Dashboard />
        </StrictMode>
    );

    const token = await ensurePrimaryAuthSession(undefined, { interactive: false });
    if (token) {
        console.log('[BOOT] Sessão estabelecida com sucesso');
    } else {
        console.warn('[BOOT] Sessão AAD não estabelecida no boot; painel segue em modo resiliente.');
    }

    startTokenRefreshLoop(() => {
        // Keep TV panel alive: never drop UI due to auth refresh failures.
        void ensurePrimaryAuthSession(undefined, { interactive: false }).then((recovered) => {
            if (recovered) {
                console.log('[BOOT] Sessão recuperada silenciosamente após expiração.');
                return;
            }
            console.warn('[BOOT] Não foi possível recuperar sessão silenciosa. Painel permanece exibindo dados server-side.');
        });
    });

    window.addEventListener('token-expired', () => {
        console.warn('[BOOT] Evento token-expired recebido. Tentando recuperar sessão silenciosamente...');
        void ensurePrimaryAuthSession(undefined, { interactive: false }).then((recovered) => {
            if (recovered) {
                console.log('[BOOT] Sessão recuperada via token-expired.');
                return;
            }
            console.warn('[BOOT] Recuperação silenciosa falhou após token-expired. Painel permanece ativo.');
        });
    });
}

void bootstrap();
