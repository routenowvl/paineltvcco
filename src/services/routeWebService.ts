import { getValidToken } from './tokenService';

const API_BASE = '/api';

export interface RouteWebEvent {
    id: number;
    route_id: number;
    event_id: number | null;
    plant_id: number;
    filial: string;
    operacao: string;
    rota_codigo: string;
    motorista: string;
    placa: string;
    type_name: string;
    reference: string;
    reference_code: string;
    status: string;
    executed: boolean | null;
    expected_arrival: string | null;
    actual_arrival: string | null;
    expected_departure: string | null;
    actual_departure: string | null;
    motivo: string;
    status_type: string;
    is_already_launched: boolean;
    occurrence_id: number | null;
    occurrence_type_id: number | null;
    occurrence_type_description: string;
    occurrence_inserted_by: string;
    occurrence_inserted_at: string | null;
    event_created_at: string | null;
    event_updated_at: string | null;
    fetched_at: string;
    data_referencia: string;
}

export interface RouteWebRoute {
    id: number;
    route_id: number;
    route_plan_id: string | null;
    schedule_order_id: number | null;
    plant_id: number;
    datalake_plant_id: number | null;
    filial: string;
    operacao: string;
    roadmap_code: string;
    status: string;
    specific_status: string;
    general_status: string;
    placa: string;
    motorista: string;
    last_driver_id: number | null;
    last_vehicle_id: number | null;
    smartquestion_actual_start_time: string | null;
    smartquestion_actual_end_time: string | null;
    smartquestion_collected_liters: number | null;
    smartquestion_unloading_plate: string;
    start_time: string | null;
    actual_start_time: string | null;
    expected_end_time: string | null;
    actual_end_time: string | null;
    expected_liters: number | null;
    collected_liters: number | null;
    unloaded_liters: number | null;
    volume: number | null;
    expected_km: number | null;
    actual_km: number | null;
    last_landmark: string;
    data_referencia: string;
    fetched_at: string;
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let lastTokenEventTime = 0;
const TOKEN_EVENT_DEBOUNCE_MS = 10000;

const dispatchTokenExpired = () => {
    const now = Date.now();
    if (now - lastTokenEventTime < TOKEN_EVENT_DEBOUNCE_MS) return;
    lastTokenEventTime = now;
    window.dispatchEvent(new CustomEvent('token-expired'));
};

async function graphFetch(
    endpoint: string,
    token: string,
    options: RequestInit = {},
    retryCount = 0,
    maxRetries = 4
) {
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = endpoint.startsWith('https://')
        ? endpoint
        : `https://graph.microsoft.com/v1.0${endpoint}${options.method === 'GET' || !options.method ? `${separator}t=${Date.now()}` : ''}`;

    const headers: Record<string, string> = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'HonorNonIndexedQueriesWarningMayFailOverLargeLists, HonorNonIndexedQueriesWarningMayFailRandomly'
    };

    try {
        const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers as Record<string, string> } });

        if (!res.ok) {
            let errDetail = '';
            let retryAfter = 0;

            try {
                const err = await res.json();
                errDetail = err.error?.message || JSON.stringify(err);
            } catch {
                errDetail = await res.text();
            }

            retryAfter = parseInt(res.headers.get('Retry-After') || '0', 10);

            if ((res.status === 429 || res.status === 503) && retryCount < maxRetries) {
                const delayTime = retryAfter > 0
                    ? retryAfter * 1000
                    : Math.min(1000 * Math.pow(2, retryCount) + Math.random() * 1000, 30000);

                console.warn(`[GRAPH_THROTTLED] Tentativa ${retryCount + 1}/${maxRetries}. Delay: ${delayTime}ms`);
                await delay(delayTime);
                return graphFetch(endpoint, token, options, retryCount + 1, maxRetries);
            }

            if (res.status === 401 || errDetail.includes('expired') || errDetail.includes('invalid')) {
                console.error('[GRAPH_API] Token expirado ou inválido. Status:', res.status);
                dispatchTokenExpired();
            }

            throw new Error(errDetail);
        }

        return res.status === 204 ? null : res.json();
    } catch (error: any) {
        if (retryCount >= maxRetries) throw error;
        throw error;
    }
}

const todayISO = (): string => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export const fetchRouteWebEvents = async (dataReferencia?: string, plantIds?: number[]): Promise<RouteWebEvent[]> => {
    const date = dataReferencia || todayISO();
    const body: Record<string, any> = { dataReferencia: date };
    if (plantIds && plantIds.length > 0) body.plantIds = plantIds;

    const response = await fetch(`${API_BASE}/route-web-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error || `Erro ${response.status} ao consultar eventos`);
    }

    const data = await response.json();
    return data.events || [];
};

export const fetchRouteWebRoutes = async (dataReferencia?: string, plantIds?: number[]): Promise<RouteWebRoute[]> => {
    const date = dataReferencia || todayISO();
    const body: Record<string, any> = { dataReferencia: date };
    if (plantIds && plantIds.length > 0) body.plantIds = plantIds;

    const response = await fetch(`${API_BASE}/route-web-routes-db`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error || `Erro ${response.status} ao consultar rotas`);
    }

    const data = await response.json();
    return data.routes || [];
};

export interface PlantConfig {
    plantId: number | null;
    datalakePlantId: number | null;
    operacao: string;
    filial: string;
    email: string;
    tolerancia: string | null;
}

const parseConfigInt = (raw: unknown): number | null => {
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.trunc(raw);
    if (raw == null) return null;
    const normalized = String(raw).trim();
    if (!normalized) return null;
    const n = Number(normalized.replace(',', '.'));
    return Number.isFinite(n) ? Math.trunc(n) : null;
};

export interface SaidaRotaItem {
    id: string;
    title: string;
    operacao: string;
    statusOp: string | null;
    motivoAtraso: string | null;
    horarioSaida: string | null;
    observacao: string | null;
    horarioInicio: string | null;
    placa: string;
    tempoResposta: string | null;
}

export interface NaoColetaItem {
    id: string;
    motivo: string;
    operacao: string;
    culpabilidade: string;
}

export interface ColetaPrevistaItem {
    id: string;
    operacao: string;
    qntColetas: number;
}

export const fetchColetasPrevistas = async (dataReferencia?: string): Promise<ColetaPrevistaItem[]> => {
    const date = dataReferencia || todayISO();

    const response = await fetch(`${API_BASE}/cco-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataReferencia: date })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error || `Erro ${response.status} ao consultar coletas previstas`);
    }

    const data = await response.json();
    const coletas = data.coletasPrevistas || [];

    return coletas.map((c: any, idx: number): ColetaPrevistaItem => ({
        id: String(idx),
        operacao: String(c.operacao || '').trim(),
        qntColetas: Number(c.qnt_coletas) || 0,
    }));
};

export const fetchNaoColetasMotivos = async (dataReferencia?: string): Promise<NaoColetaItem[]> => {
    const date = dataReferencia || todayISO();

    const response = await fetch(`${API_BASE}/cco-non-collections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataReferencia: date })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error || `Erro ${response.status} ao consultar não coletas`);
    }

    const data = await response.json();
    const rows = data.nonCollections || [];

    return rows.map((nc: any): NaoColetaItem => ({
        id: String(nc.id),
        motivo: String(nc.motivo || '').trim(),
        operacao: String(nc.operacao || '').trim(),
        culpabilidade: String(nc.culpabilidade || '').trim(),
    }));
};

export const fetchSaidasRotas = async (dataReferencia?: string): Promise<SaidaRotaItem[]> => {
    const date = dataReferencia || todayISO();

    const response = await fetch(`${API_BASE}/cco-departures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataReferencia: date })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error || `Erro ${response.status} ao consultar saídas de rotas`);
    }

    const data = await response.json();
    const departures = data.departures || [];

    return departures.map((d: any): SaidaRotaItem => ({
        id: String(d.id),
        title: String(d.rota || ''),
        operacao: String(d.operacao || ''),
        statusOp: d.status_rota || null,
        motivoAtraso: d.motivo_atraso || null,
        horarioSaida: d.hora_prevista || null,
        observacao: d.observacao || null,
        horarioInicio: d.hora_saida || null,
        placa: String(d.placa_veiculo || '').trim(),
        tempoResposta: d.tempo_resposta || null,
    }));
};

export interface MaintenanceItem {
    titulo: string;
    placa: string;
    status: string;
    planta: string;
    data_planejada: string;
}

export const fetchMaintenances = async (dataReferencia?: string): Promise<MaintenanceItem[]> => {
    const date = dataReferencia || todayISO();

    const response = await fetch(`${API_BASE}/pcm-maintenance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataReferencia: date })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error || `Erro ${response.status} ao consultar manutenções`);
    }

    const data = await response.json();
    return data.maintenances || [];
};

export const fetchRotasPendentesCount = async (plantIds?: number[]): Promise<number> => {
    const body: Record<string, any> = {};
    if (plantIds && plantIds.length > 0) body.plantIds = plantIds;

    const response = await fetch(`${API_BASE}/rotas-pendentes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error || `Erro ${response.status} ao consultar rotas pendentes`);
    }

    const data = await response.json();
    return data.count ?? 0;
};

export interface ProdutorSemColetaItem {
    operacao: string;
    codigo: string;
    produtor: string;
    ultima_coleta: string | null;
}

export const fetchProdutoresSemColeta = async (): Promise<ProdutorSemColetaItem[]> => {
    const response = await fetch(`${API_BASE}/ultima-coleta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error || `Erro ${response.status} ao consultar produtores sem coleta`);
    }

    const data = await response.json();
    return data.produtores || [];
};

export const fetchPlantConfigs = async (): Promise<PlantConfig[]> => {
    const response = await fetch(`${API_BASE}/cco-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error || `Erro ${response.status} ao consultar config de operações`);
    }

    const data = await response.json();
    const configs = data.configs || [];

    return configs
        .map((c: any): PlantConfig | null => {
            const operacao = String(c.operacao || '').trim();
            if (!operacao) return null;

            const plantId = parseConfigInt(c.plant_id);
            const datalakePlantId = parseConfigInt(c.datalake_plant_id);

            return {
                plantId: plantId ?? null,
                datalakePlantId: datalakePlantId ?? plantId ?? null,
                operacao,
                filial: String(c.nome_exibicao || operacao).trim(),
                email: String(c.email || '').trim(),
                tolerancia: c.tolerancia != null ? String(c.tolerancia).trim() : null,
            };
        })
        .filter((c: PlantConfig | null): c is PlantConfig => c !== null);
};

// ─── Trend 7 dias ────────────────────────────────────────────────
export interface TrendDay {
    date: string;
    value: number | null;
    total: number;
}

export const fetchSaidasTrend = async (
    operacoes: string[]
): Promise<TrendDay[]> => {
    const response = await fetch(`${API_BASE}/cco-departures-trend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operacoes })
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Erro desconhecido' }));
        throw new Error(err.error || `Erro ${response.status} ao consultar tendência`);
    }

    const data = await response.json();
    return data.trend || [];
};
