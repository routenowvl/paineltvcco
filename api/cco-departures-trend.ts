import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getDeparturesByDate, closeCcoPool } from '../utils/rweDb.js';
import { getHistFromSharePoint } from '../utils/graphAppAuth.js';

const normalizeStr = (s: string): string =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();

const MOTIVOS_INTERNOS = ['mao de obra', 'mao de obra', 'manutencao', 'manutencao', 'logistica', 'logistica'];
const isMotivoInterno = (motivo: string | null): boolean => {
    if (!motivo) return false;
    const norm = motivo.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
    return MOTIVOS_INTERNOS.some(m => norm.includes(m));
};

const toIsoDay = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

interface DayStats {
    total: number;
    descontam: number;
    adiantadas: number;
}

const countRow = (stats: DayStats, statusRota: string | null, motivoAtraso: string | null) => {
    const st = (statusRota || '').toUpperCase();
    stats.total += 1;
    if (st.includes('ATRAS') && isMotivoInterno(motivoAtraso)) {
        stats.descontam += 1;
    }
    if (st.includes('ADIANT')) {
        stats.adiantadas += 1;
    }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    if (req.method !== 'GET' && req.method !== 'POST') {
        return res.status(405).json({ success: false, error: 'Method not allowed' });
    }

    try {
        const body = req.method === 'POST' ? req.body : req.query;
        const operacoes: string[] = Array.isArray(body?.operacoes)
            ? body.operacoes.map(String).filter(Boolean)
            : [];
        const operacaoNorms = new Set(operacoes.map(normalizeStr));

        const today = new Date();
        const start = new Date(today);
        start.setDate(start.getDate() - 6);
        const startDate = toIsoDay(start);
        const endDate = toIsoDay(today);

        // Build 7-day map
        const byDate = new Map<string, DayStats>();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            byDate.set(toIsoDay(d), { total: 0, descontam: 0, adiantadas: 0 });
        }

        const todayStr = toIsoDay(today);

        // 1) Today from PostgreSQL
        try {
            const todayRows = await getDeparturesByDate(todayStr);
            for (const row of todayRows) {
                if (operacaoNorms.size > 0 && !operacaoNorms.has(normalizeStr(row.operacao || ''))) continue;
                const stats = byDate.get(todayStr);
                if (stats) countRow(stats, row.status_rota, row.motivo_atraso);
            }
        } catch (err: any) {
            console.warn('[TREND] PostgreSQL indisponível para hoje:', err?.message || err);
        }

        // 2) Past 6 days from SharePoint checklist_web_hist
        const pastEnd = new Date(today);
        pastEnd.setDate(pastEnd.getDate() - 1);
        const pastEndStr = toIsoDay(pastEnd);

        if (startDate <= pastEndStr) {
            try {
                const histRows = await getHistFromSharePoint(startDate, pastEndStr, operacoes);
                for (const row of histRows) {
                    const stats = byDate.get(row.data_operacao);
                    if (stats) countRow(stats, row.status_rota, row.motivo_atraso);
                }
            } catch (err: any) {
                console.warn('[TREND] SharePoint hist indisponível:', err?.message || err);
            }
        }

        // Build trend array
        const trend: Array<{ date: string; value: number | null; total: number }> = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const key = toIsoDay(d);
            const stats = byDate.get(key);
            const value = stats && stats.total > 0
                ? Math.round(((stats.total - stats.descontam - stats.adiantadas) / stats.total) * 10000) / 100
                : null;
            trend.push({ date: key, value, total: stats?.total ?? 0 });
        }

        return res.status(200).json({ success: true, trend });
    } catch (error: any) {
        console.error('[CCO_DEPARTURES_TREND] Erro:', error?.message || error);
        return res.status(500).json({ success: false, error: error?.message || 'Erro' });
    } finally {
        await closeCcoPool().catch(() => {});
    }
}
