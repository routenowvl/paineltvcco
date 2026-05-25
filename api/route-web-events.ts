import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
    getRouteWebEventsByDateAndPlants,
    closeRwePool,
    type RouteWebEventDbRow
} from '../utils/rweDb.js';

export type { RouteWebEventDbRow };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const body = req.method === 'POST' ? req.body : req.query;
        const dataReferencia = String(body?.dataReferencia || '').trim();
        const plantIdsRaw = body?.plantIds;

        if (!dataReferencia || !/^\d{4}-\d{2}-\d{2}$/.test(dataReferencia)) {
            return res.status(400).json({ success: false, error: 'dataReferencia inválida (YYYY-MM-DD)' });
        }

        let plantIds: number[] = [];
        if (Array.isArray(plantIdsRaw)) {
            plantIds = plantIdsRaw.map(Number).filter(Number.isFinite);
        } else if (plantIdsRaw != null) {
            const parsed = Number(plantIdsRaw);
            if (Number.isFinite(parsed)) plantIds = [parsed];
        }

        const rows: RouteWebEventDbRow[] = await getRouteWebEventsByDateAndPlants(dataReferencia, plantIds);

        return res.status(200).json({
            success: true,
            dataReferencia,
            plantIds,
            count: rows.length,
            events: rows
        });
    } catch (error: any) {
        console.error('[ROUTE_WEB_EVENTS_API] Erro:', error?.message || error);
        return res.status(500).json({
            success: false,
            error: error?.message || 'Erro ao consultar eventos'
        });
    } finally {
        await closeRwePool().catch(() => {});
    }
}
