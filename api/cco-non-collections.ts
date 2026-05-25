import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getNonCollectionsByDate, closeCcoPool, type NonCollectionRow } from '../utils/rweDb.js';

export type { NonCollectionRow };

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

        const rows: NonCollectionRow[] = await getNonCollectionsByDate(dataReferencia);

        return res.status(200).json({
            success: true,
            dataReferencia,
            count: rows.length,
            nonCollections: rows
        });
    } catch (error: any) {
        console.error('[CCO_NON_COLLECTIONS_API] Erro:', error?.message || error);
        return res.status(500).json({
            success: false,
            error: error?.message || 'Erro ao consultar não coletas'
        });
    } finally {
        await closeCcoPool().catch(() => {});
    }
}
