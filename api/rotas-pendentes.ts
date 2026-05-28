import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRotasPendentesCount, closeRotasPendPool } from '../utils/rweDb.js';

const parsePlantIds = (raw: unknown): number[] => {
    const toNum = (v: unknown): number | null => {
        const n = Number(String(v).trim());
        return Number.isFinite(n) ? Math.trunc(n) : null;
    };

    const collect = (values: unknown[]): number[] => {
        const ids: number[] = [];
        for (const value of values) {
            if (typeof value === 'string' && value.includes(',')) {
                for (const part of value.split(',')) {
                    const n = toNum(part);
                    if (n !== null) ids.push(n);
                }
                continue;
            }
            const n = toNum(value);
            if (n !== null) ids.push(n);
        }
        return Array.from(new Set(ids.filter(id => id > 0)));
    };

    if (Array.isArray(raw)) return collect(raw);
    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return [];
        if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
            try {
                const parsed = JSON.parse(trimmed);
                if (Array.isArray(parsed)) return collect(parsed);
            } catch {
                // fallback below
            }
        }
        if (trimmed.includes(',')) return collect(trimmed.split(','));
        return collect([trimmed]);
    }
    if (raw == null) return [];
    return collect([raw]);
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const body = req.method === 'POST' ? req.body : req.query;
        const hasPlantIdsField = body && Object.prototype.hasOwnProperty.call(body, 'plantIds');
        const plantIds = parsePlantIds(body?.plantIds);

        const count = await getRotasPendentesCount(plantIds);

        return res.status(200).json({
            success: true,
            count,
            filtered: hasPlantIdsField,
            plantIds
        });
    } catch (error: any) {
        console.error('[ROTAS_PENDENTES_API] Erro:', error?.message || error);
        return res.status(500).json({
            success: false,
            error: error?.message || 'Erro ao consultar rotas pendentes'
        });
    } finally {
        await closeRotasPendPool().catch(() => {});
    }
}
