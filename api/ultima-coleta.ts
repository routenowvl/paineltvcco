import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getProdutoresSemColeta, closeUcPool } from '../utils/rweDb.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const rows = await getProdutoresSemColeta();

        return res.status(200).json({
            success: true,
            count: rows.length,
            produtores: rows
        });
    } catch (error: any) {
        console.error('[ULTIMA_COLETA_API] Erro:', error?.message || error);
        return res.status(500).json({
            success: false,
            error: error?.message || 'Erro ao consultar produtores sem coleta'
        });
    } finally {
        await closeUcPool().catch(() => {});
    }
}
