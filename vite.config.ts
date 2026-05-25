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
