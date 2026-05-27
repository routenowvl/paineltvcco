import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import {
    getRouteWebEventsByDateAndPlants,
    getRouteWebRoutesByDateAndPlants,
    getMaintenancesByDate,
    getRotasPendentesCount,
    getProdutoresSemColeta,
    getDeparturesByDate,
    getNonCollectionsByDate,
    getOperacaoConfigs,
    getColetasPrevistasByDate,
    type RouteWebEventDbRow,
    type RouteWebRouteDbRow,
    type MaintenanceDbRow
} from './utils/rweDb';
import { getHistFromSharePoint } from './utils/graphAppAuth';

const readJsonBody = (req: any): Promise<any> =>
    new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf-8');
                resolve(raw ? JSON.parse(raw) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });

const writeJson = (res: any, status: number, payload: any) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
};

const routeWebDevPlugin = (mode: string) => ({
    name: 'route-web-dev-api',
    configureServer(server: any) {
        server.middlewares.use(async (req: any, res: any, next: any) => {
            Object.assign(process.env, loadEnv(mode, '.', ''));

            const pathname = String(req.url || '').split('?')[0];

            if ((req.method === 'POST' || req.method === 'GET') && pathname === '/api/route-web-events') {
                try {
                    const body = req.method === 'POST'
                        ? await readJsonBody(req)
                        : Object.fromEntries(new URL(String(req.url || ''), 'http://localhost').searchParams);
                    const dataReferencia = String(body?.dataReferencia || '').trim();

                    if (!dataReferencia || !/^\d{4}-\d{2}-\d{2}$/.test(dataReferencia)) {
                        return writeJson(res, 400, { success: false, error: 'dataReferencia inválida (YYYY-MM-DD)' });
                    }

                    let plantIds: number[] = [];
                    const plantIdsRaw = body?.plantIds;
                    if (Array.isArray(plantIdsRaw)) {
                        plantIds = plantIdsRaw.map(Number).filter(Number.isFinite);
                    } else if (plantIdsRaw != null) {
                        const parsed = Number(plantIdsRaw);
                        if (Number.isFinite(parsed)) plantIds = [parsed];
                    }

                    const rows: RouteWebEventDbRow[] = await getRouteWebEventsByDateAndPlants(dataReferencia, plantIds);

                    return writeJson(res, 200, {
                        success: true,
                        dataReferencia,
                        plantIds,
                        count: rows.length,
                        events: rows
                    });
                } catch (error: any) {
                    console.error('[ROUTE_WEB_EVENTS][DEV] Erro:', error?.message || error);
                    return writeJson(res, 500, {
                        success: false,
                        error: error?.message || 'Erro ao consultar eventos'
                    });
                }
            }

            if ((req.method === 'POST' || req.method === 'GET') && pathname === '/api/route-web-routes-db') {
                try {
                    const body = req.method === 'POST'
                        ? await readJsonBody(req)
                        : Object.fromEntries(new URL(String(req.url || ''), 'http://localhost').searchParams);
                    const dataReferencia = String(body?.dataReferencia || '').trim();

                    if (!dataReferencia || !/^\d{4}-\d{2}-\d{2}$/.test(dataReferencia)) {
                        return writeJson(res, 400, { success: false, error: 'dataReferencia inválida (YYYY-MM-DD)' });
                    }

                    let plantIds: number[] = [];
                    const plantIdsRaw = body?.plantIds;
                    if (Array.isArray(plantIdsRaw)) {
                        plantIds = plantIdsRaw.map(Number).filter(Number.isFinite);
                    } else if (plantIdsRaw != null) {
                        const parsed = Number(plantIdsRaw);
                        if (Number.isFinite(parsed)) plantIds = [parsed];
                    }

                    const rows: RouteWebRouteDbRow[] = await getRouteWebRoutesByDateAndPlants(dataReferencia, plantIds);

                    return writeJson(res, 200, {
                        success: true,
                        dataReferencia,
                        plantIds,
                        count: rows.length,
                        routes: rows
                    });
                } catch (error: any) {
                    console.error('[ROUTE_WEB_ROUTES_DB][DEV] Erro:', error?.message || error);
                    return writeJson(res, 500, {
                        success: false,
                        error: error?.message || 'Erro ao consultar rotas'
                    });
                }
            }

            if ((req.method === 'POST' || req.method === 'GET') && pathname === '/api/pcm-maintenance') {
                try {
                    const body = req.method === 'POST'
                        ? await readJsonBody(req)
                        : Object.fromEntries(new URL(String(req.url || ''), 'http://localhost').searchParams);
                    const dataReferencia = String(body?.dataReferencia || '').trim();

                    if (!dataReferencia || !/^\d{4}-\d{2}-\d{2}$/.test(dataReferencia)) {
                        return writeJson(res, 400, { success: false, error: 'dataReferencia inválida (YYYY-MM-DD)' });
                    }

                    const rows: MaintenanceDbRow[] = await getMaintenancesByDate(dataReferencia);

                    return writeJson(res, 200, {
                        success: true,
                        dataReferencia,
                        count: rows.length,
                        maintenances: rows
                    });
                } catch (error: any) {
                    console.error('[PCM_MAINTENANCE][DEV] Erro:', error?.message || error);
                    return writeJson(res, 500, {
                        success: false,
                        error: error?.message || 'Erro ao consultar manutenções'
                    });
                }
            }

            if ((req.method === 'POST' || req.method === 'GET') && pathname === '/api/rotas-pendentes') {
                try {
                    const body = req.method === 'POST'
                        ? await readJsonBody(req)
                        : Object.fromEntries(new URL(String(req.url || ''), 'http://localhost').searchParams);

                    let plantIds: number[] = [];
                    const plantIdsRaw = body?.plantIds;
                    if (Array.isArray(plantIdsRaw)) {
                        plantIds = plantIdsRaw.map(Number).filter(Number.isFinite);
                    } else if (plantIdsRaw != null) {
                        const parsed = Number(plantIdsRaw);
                        if (Number.isFinite(parsed)) plantIds = [parsed];
                    }

                    const count = await getRotasPendentesCount(plantIds);
                    return writeJson(res, 200, { success: true, count });
                } catch (error: any) {
                    console.error('[ROTAS_PENDENTES][DEV] Erro:', error?.message || error);
                    return writeJson(res, 500, {
                        success: false,
                        error: error?.message || 'Erro ao consultar rotas pendentes'
                    });
                }
            }

            if ((req.method === 'POST' || req.method === 'GET') && pathname === '/api/cco-departures-trend') {
                try {
                    const body = req.method === 'POST'
                        ? await readJsonBody(req)
                        : Object.fromEntries(new URL(String(req.url || ''), 'http://localhost').searchParams);
                    const operacoes: string[] = Array.isArray(body?.operacoes)
                        ? body.operacoes.map(String).filter(Boolean)
                        : [];

                    const normStr = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();
                    const motivosInternos = ['mao de obra', 'manutencao', 'logistica'];
                    const isMotivoInterno = (m: string | null) => {
                        if (!m) return false;
                        const n = m.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
                        return motivosInternos.some(mi => n.includes(mi));
                    };
                    const operacaoNorms = new Set(operacoes.map(normStr));
                    const toDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

                    const today = new Date();
                    const todayStr = toDay(today);
                    const byDate = new Map<string, { total: number; descontam: number; adiantadas: number }>();
                    for (let i = 6; i >= 0; i--) {
                        const d = new Date(today); d.setDate(d.getDate() - i);
                        byDate.set(toDay(d), { total: 0, descontam: 0, adiantadas: 0 });
                    }

                    // Today from DB
                    try {
                        const rows = await getDeparturesByDate(todayStr);
                        for (const row of rows) {
                            if (operacaoNorms.size > 0 && !operacaoNorms.has(normStr(row.operacao || ''))) continue;
                            const st = (row.status_rota || '').toUpperCase();
                            const stats = byDate.get(todayStr)!;
                            stats.total += 1;
                            if (st.includes('ATRAS') && isMotivoInterno(row.motivo_atraso)) stats.descontam += 1;
                            if (st.includes('ADIANT')) stats.adiantadas += 1;
                        }
                    } catch {}

                    // Past 6 days from SharePoint
                    const pastEnd = new Date(today); pastEnd.setDate(pastEnd.getDate() - 1);
                    const start = new Date(today); start.setDate(start.getDate() - 6);
                    const startStr = toDay(start);
                    const pastEndStr = toDay(pastEnd);
                    if (startStr <= pastEndStr) {
                        try {
                            const hist = await getHistFromSharePoint(startStr, pastEndStr, operacoes);
                            for (const row of hist) {
                                const stats = byDate.get(row.data_operacao);
                                if (!stats) continue;
                                const st = (row.status_rota || '').toUpperCase();
                                stats.total += 1;
                                if (st.includes('ATRAS') && isMotivoInterno(row.motivo_atraso)) stats.descontam += 1;
                                if (st.includes('ADIANT')) stats.adiantadas += 1;
                            }
                        } catch (e: any) { console.warn('[TREND][DEV] SharePoint err:', e?.message); }
                    }

                    const trend = [];
                    for (let i = 6; i >= 0; i--) {
                        const d = new Date(today); d.setDate(d.getDate() - i);
                        const key = toDay(d);
                        const s = byDate.get(key)!;
                        const value = s.total > 0 ? Math.round(((s.total - s.descontam - s.adiantadas) / s.total) * 10000) / 100 : null;
                        trend.push({ date: key, value, total: s.total });
                    }

                    return writeJson(res, 200, { success: true, trend });
                } catch (error: any) {
                    console.error('[CCO_DEPARTURES_TREND][DEV] Erro:', error?.message || error);
                    return writeJson(res, 500, { success: false, error: error?.message || 'Erro' });
                }
            }

            if ((req.method === 'POST' || req.method === 'GET') && pathname === '/api/ultima-coleta') {
                try {
                    const rows = await getProdutoresSemColeta();
                    return writeJson(res, 200, {
                        success: true,
                        count: rows.length,
                        produtores: rows
                    });
                } catch (error: any) {
                    console.error('[ULTIMA_COLETA][DEV] Erro:', error?.message || error);
                    return writeJson(res, 500, {
                        success: false,
                        error: error?.message || 'Erro ao consultar produtores sem coleta'
                    });
                }
            }

            if ((req.method === 'POST' || req.method === 'GET') && pathname === '/api/cco-departures') {
                try {
                    const body = req.method === 'POST'
                        ? await readJsonBody(req)
                        : Object.fromEntries(new URL(String(req.url || ''), 'http://localhost').searchParams);
                    const dataReferencia = String(body?.dataReferencia || '').trim();

                    if (!dataReferencia || !/^\d{4}-\d{2}-\d{2}$/.test(dataReferencia)) {
                        return writeJson(res, 400, { success: false, error: 'dataReferencia inválida (YYYY-MM-DD)' });
                    }

                    const rows = await getDeparturesByDate(dataReferencia);
                    return writeJson(res, 200, {
                        success: true,
                        dataReferencia,
                        count: rows.length,
                        departures: rows
                    });
                } catch (error: any) {
                    console.error('[CCO_DEPARTURES][DEV] Erro:', error?.message || error);
                    return writeJson(res, 500, {
                        success: false,
                        error: error?.message || 'Erro ao consultar saídas de rotas'
                    });
                }
            }

            if ((req.method === 'POST' || req.method === 'GET') && pathname === '/api/cco-non-collections') {
                try {
                    const body = req.method === 'POST'
                        ? await readJsonBody(req)
                        : Object.fromEntries(new URL(String(req.url || ''), 'http://localhost').searchParams);
                    const dataReferencia = String(body?.dataReferencia || '').trim();

                    if (!dataReferencia || !/^\d{4}-\d{2}-\d{2}$/.test(dataReferencia)) {
                        return writeJson(res, 400, { success: false, error: 'dataReferencia inválida (YYYY-MM-DD)' });
                    }

                    const rows = await getNonCollectionsByDate(dataReferencia);
                    return writeJson(res, 200, {
                        success: true,
                        dataReferencia,
                        count: rows.length,
                        nonCollections: rows
                    });
                } catch (error: any) {
                    console.error('[CCO_NON_COLLECTIONS][DEV] Erro:', error?.message || error);
                    return writeJson(res, 500, {
                        success: false,
                        error: error?.message || 'Erro ao consultar não coletas'
                    });
                }
            }

            if ((req.method === 'POST' || req.method === 'GET') && pathname === '/api/cco-config') {
                try {
                    const body = req.method === 'POST'
                        ? await readJsonBody(req)
                        : Object.fromEntries(new URL(String(req.url || ''), 'http://localhost').searchParams);
                    const dataReferencia = String(body?.dataReferencia || '').trim();

                    const [configs, coletas] = await Promise.all([
                        getOperacaoConfigs(),
                        dataReferencia && /^\d{4}-\d{2}-\d{2}$/.test(dataReferencia)
                            ? getColetasPrevistasByDate(dataReferencia)
                            : Promise.resolve([])
                    ]);

                    return writeJson(res, 200, {
                        success: true,
                        configs,
                        coletasPrevistas: coletas
                    });
                } catch (error: any) {
                    console.error('[CCO_CONFIG][DEV] Erro:', error?.message || error);
                    return writeJson(res, 500, {
                        success: false,
                        error: error?.message || 'Erro ao consultar config de operações'
                    });
                }
            }

            next();
        });
    }
});

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    Object.assign(process.env, env);

    return {
        plugins: [react(), routeWebDevPlugin(mode)],
        server: {
            port: Number(env.VITE_SERVER_PORT) || 3001,
            host: true
        }
    };
});
