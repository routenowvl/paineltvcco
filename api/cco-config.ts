import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getOperacaoConfigs, getColetasPrevistasByDate, closeCcoPool, type OperacaoConfigRow, type ColetaPrevistaRow } from '../utils/rweDb.js';

export type { OperacaoConfigRow, ColetaPrevistaRow };

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const body = req.method === 'POST' ? req.body : req.query;
        const dataReferencia = String(body?.dataReferencia || '').trim();

        const [configs, coletas] = await Promise.all([
            getOperacaoConfigs(),
            dataReferencia && /^\d{4}-\d{2}-\d{2}$/.test(dataReferencia)
                ? getColetasPrevistasByDate(dataReferencia)
                : Promise.resolve([] as ColetaPrevistaRow[])
        ]);

        return res.status(200).json({
            success: true,
            configs,
            coletasPrevistas: coletas
        });
    } catch (error: any) {
        console.error('[CCO_CONFIG_API] Erro:', error?.message || error);
        return res.status(500).json({
            success: false,
            error: error?.message || 'Erro ao consultar config de operações'
        });
    } finally {
        await closeCcoPool().catch(() => {});
    }
}
