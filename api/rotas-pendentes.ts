import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getRotasPendentesCount, closeRotasPendPool } from '../utils/rweDb.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const body = req.method === 'POST' ? req.body : req.query;

        let plantIds: number[] = [];
        const plantIdsRaw = body?.plantIds;
        if (Array.isArray(plantIdsRaw)) {
            plantIds = plantIdsRaw.map(Number).filter(Number.isFinite);
        } else if (plantIdsRaw != null) {
            const parsed = Number(plantIdsRaw);
            if (Number.isFinite(parsed)) plantIds = [parsed];
        }

        const count = await getRotasPendentesCount(plantIds);

        return res.status(200).json({
            success: true,
            count
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
