import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDeparturesByDate, closeCcoPool, type DepartureRow } from '../utils/rweDb.js';

export type { DepartureRow };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const body = req.method === 'POST' ? req.body : req.query;
        const dataReferencia = String(body?.dataReferencia || '').trim();

        if (!dataReferencia || !/^\d{4}-\d{2}-\d{2}$/.test(dataReferencia)) {
            return res.status(400).json({ success: false, error: 'dataReferencia inválida (YYYY-MM-DD)' });
        }

        const rows: DepartureRow[] = await getDeparturesByDate(dataReferencia);

        return res.status(200).json({
            success: true,
            dataReferencia,
            count: rows.length,
            departures: rows
        });
    } catch (error: any) {
        console.error('[CCO_DEPARTURES_API] Erro:', error?.message || error);
        return res.status(500).json({
            success: false,
            error: error?.message || 'Erro ao consultar saídas de rotas'
        });
    } finally {
        await closeCcoPool().catch(() => {});
    }
}
