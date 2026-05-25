import type { VercelRequest, VercelResponse } from '@vercel/node';

interface RateEntry { count: number; firstAttempt: number; lockedUntil: number | null }
const rateLimitMap = new Map<string, RateEntry>();

const MAX_ATTEMPTS = Number(process.env.LIMITAR_RETRY_LOGIN) || 5;
const LOCKOUT_MS = (Number(process.env.LOGIN_LOCKOUT_MINUTES) || 15) * 60 * 1000;
const WINDOW_MS = 15 * 60 * 1000;

function getClientIp(req: VercelRequest): string {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
    if (Array.isArray(forwarded)) return forwarded[0].trim();
    return (req.headers['x-real-ip'] as string) || 'unknown';
}

function checkRateLimit(ip: string): { allowed: boolean; remaining: number; lockedUntil: number | null } {
    const now = Date.now();
    let entry = rateLimitMap.get(ip);

    if (!entry || (now - entry.firstAttempt > WINDOW_MS && !entry.lockedUntil)) {
        entry = { count: 0, firstAttempt: now, lockedUntil: null };
        rateLimitMap.set(ip, entry);
    }

    if (entry.lockedUntil && now < entry.lockedUntil) {
        return { allowed: false, remaining: 0, lockedUntil: entry.lockedUntil };
    }

    if (entry.lockedUntil && now >= entry.lockedUntil) {
        entry.count = 0;
        entry.firstAttempt = now;
        entry.lockedUntil = null;
    }

    return { allowed: true, remaining: MAX_ATTEMPTS - entry.count, lockedUntil: null };
}

function recordFailedAttempt(ip: string): { lockedOut: boolean; lockedUntil: number | null } {
    const entry = rateLimitMap.get(ip);
    if (!entry) return { lockedOut: false, lockedUntil: null };

    entry.count += 1;

    if (entry.count >= MAX_ATTEMPTS) {
        entry.lockedUntil = Date.now() + LOCKOUT_MS;
        return { lockedOut: true, lockedUntil: entry.lockedUntil };
    }

    return { lockedOut: false, lockedUntil: null };
}

const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupExpired() {
    const now = Date.now();
    if (now - lastCleanup < CLEANUP_INTERVAL) return;
    lastCleanup = now;
    for (const [ip, entry] of rateLimitMap) {
        if (entry.lockedUntil && now >= entry.lockedUntil) {
            rateLimitMap.delete(ip);
        } else if (!entry.lockedUntil && now - entry.firstAttempt > WINDOW_MS) {
            rateLimitMap.delete(ip);
        }
    }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    cleanupExpired();

    const clientIp = getClientIp(req);

    const rateCheck = checkRateLimit(clientIp);
    if (!rateCheck.allowed) {
        const remainingMs = rateCheck.lockedUntil! - Date.now();
        const remainingMin = Math.ceil(remainingMs / 60000);
        return res.status(429).json({
            success: false,
            error: `Muitas tentativas. Tente novamente em ${remainingMin} minutos.`,
            lockedUntil: rateCheck.lockedUntil,
        });
    }

    const { token } = req.body as { token?: string };

    if (!token) {
        return res.status(400).json({ success: false, error: 'Token não fornecido' });
    }

    const secretKey = process.env.SECRET_KEY;

    if (!secretKey) {
        console.error('[TURNSTILE] SECRET_KEY não configurada');
        return res.status(500).json({ success: false, error: 'Configuração inválida' });
    }

    try {
        const verifyUrl = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

        const result = await fetch(verifyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                secret: secretKey,
                response: token,
                remoteip: clientIp,
            }),
        });

        const data = await result.json();

        if (data.success) {
            return res.status(200).json({ success: true, remaining: rateCheck.remaining });
        } else {
            const { lockedOut, lockedUntil } = recordFailedAttempt(clientIp);

            if (lockedOut) {
                return res.status(429).json({
                    success: false,
                    error: `Muitas tentativas falhas. Acesso bloqueado por ${Math.ceil(LOCKOUT_MS / 60000)} minutos.`,
                    lockedUntil,
                });
            }

            const errors = data['error-codes'] || ['unknown_error'];
            return res.status(403).json({
                success: false,
                errors,
                remaining: rateCheck.remaining - 1,
            });
        }
    } catch (error: any) {
        console.error('[TURNSTILE] Erro ao verificar token:', error.message);
        return res.status(500).json({ success: false, error: 'Erro interno na verificação' });
    }
}
