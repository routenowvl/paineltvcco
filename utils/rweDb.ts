import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

const getPool = (): pg.Pool => {
    if (pool) return pool;

    const dbUrl = String(process.env.RWE_DB_URL || '').trim();
    if (!dbUrl) {
        throw new Error('RWE_DB_URL não configurada');
    }

    const ssl = String(process.env.RWE_DB_SSL || 'true').trim().toLowerCase();
    const schema = String(process.env.RWE_DB_SCHEMA || 'public').trim();

    pool = new Pool({
        connectionString: dbUrl,
        ssl: ssl === 'true' || ssl === '1' ? { rejectUnauthorized: false } : undefined,
        max: 4,
        idleTimeoutMillis: 15_000,
        connectionTimeoutMillis: 8_000
    });

    pool.on('connect', (client) => {
        client.query(`SET search_path TO ${schema}`);
    });

    return pool;
};

export type RouteWebEventDbRow = {
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
};

export const getRouteWebEventsByDateAndPlants = async (
    dataReferencia: string,
    plantIds: number[]
): Promise<RouteWebEventDbRow[]> => {
    const client = getPool();

    const dateFilter = `DATE(expected_arrival AT TIME ZONE 'America/Sao_Paulo') = $1::date`;

    if (plantIds.length === 0) {
        const result = await client.query(
            `SELECT * FROM route_web_events WHERE ${dateFilter} ORDER BY route_id, event_id, occurrence_id`,
            [dataReferencia]
        );
        return result.rows as RouteWebEventDbRow[];
    }

    const intPlantIds = plantIds.map((id) => Number(id)).filter(Number.isFinite);
    const placeholders = intPlantIds.map((_, i) => `$${i + 2}::int`).join(',');
    const result = await client.query(
        `SELECT * FROM route_web_events WHERE ${dateFilter} AND plant_id = ANY(ARRAY[${placeholders}]) ORDER BY route_id, event_id, occurrence_id`,
        [dataReferencia, ...intPlantIds]
    );
    return result.rows as RouteWebEventDbRow[];
};

export type RouteWebRouteDbRow = {
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
};

export const getRouteWebRoutesByDateAndPlants = async (
    dataReferencia: string,
    plantIds: number[]
): Promise<RouteWebRouteDbRow[]> => {
    const client = getPool();

    if (plantIds.length === 0) {
        const result = await client.query(
            `SELECT * FROM route_web_routes WHERE data_referencia = $1::date ORDER BY roadmap_code`,
            [dataReferencia]
        );
        return result.rows as RouteWebRouteDbRow[];
    }

    const intPlantIds = plantIds.map((id) => Number(id)).filter(Number.isFinite);
    const placeholders = intPlantIds.map((_, i) => `$${i + 2}::int`).join(',');
    const result = await client.query(
        `SELECT * FROM route_web_routes WHERE data_referencia = $1::date AND plant_id = ANY(ARRAY[${placeholders}]) ORDER BY roadmap_code`,
        [dataReferencia, ...intPlantIds]
    );
    return result.rows as RouteWebRouteDbRow[];
};

export const closeRwePool = async (): Promise<void> => {
    if (pool) {
        await pool.end();
        pool = null;
    }
};

/* ── Produtores sem coleta (checklist_web DB) ────────── */

let ucPool: pg.Pool | null = null;

const getUcPool = (): pg.Pool => {
    if (ucPool) return ucPool;

    const dbUrl = String(process.env.UC_DB_URL || '').trim();
    if (!dbUrl) {
        throw new Error('UC_DB_URL não configurada');
    }

    const ssl = String(process.env.UC_DB_SSL || 'true').trim().toLowerCase();

    ucPool = new Pool({
        connectionString: dbUrl,
        ssl: ssl === 'true' || ssl === '1' ? { rejectUnauthorized: false } : undefined,
        max: 3,
        idleTimeoutMillis: 15_000,
        connectionTimeoutMillis: 8_000
    });

    return ucPool;
};

export type ProdutorSemColetaRow = {
    operacao: string;
    codigo: string;
    produtor: string;
    ultima_coleta: string | null;
};

export const getProdutoresSemColeta = async (): Promise<ProdutorSemColetaRow[]> => {
    const pool = getUcPool();
    const client = await pool.connect();
    try {
        const schema = String(process.env.UC_DB_SCHEMA || 'checklist_web').trim();
        const result = await client.query(
            `SELECT
                operacao,
                codigo,
                produtor,
                ultima_coleta
            FROM "${schema}".ultima_coleta
            WHERE ultima_coleta IS NOT NULL
            ORDER BY ultima_coleta ASC`
        );
        return result.rows as ProdutorSemColetaRow[];
    } finally {
        client.release();
    }
};

export const closeUcPool = async (): Promise<void> => {
    if (ucPool) {
        await ucPool.end();
        ucPool = null;
    }
};

/* ── PCM Maintenance (separate DB) ─────────────────────────── */

let maintPool: pg.Pool | null = null;

const getMaintPool = (): pg.Pool => {
    if (maintPool) return maintPool;

    const dbUrl = String(process.env.MAINT_DB_URL || '').trim();
    if (!dbUrl) {
        throw new Error('MAINT_DB_URL não configurada');
    }

    const ssl = String(process.env.MAINT_DB_SSL || 'true').trim().toLowerCase();
    const schema = String(process.env.MAINT_DB_SCHEMA || 'public').trim();

    maintPool = new Pool({
        connectionString: dbUrl,
        ssl: ssl === 'true' || ssl === '1' ? { rejectUnauthorized: false } : undefined,
        max: 3,
        idleTimeoutMillis: 15_000,
        connectionTimeoutMillis: 10_000
    });

    maintPool.on('connect', (client) => {
        client.query(`SET search_path TO ${schema}`);
    });

    return maintPool;
};

export type MaintenanceDbRow = {
    titulo: string;
    placa: string;
    status: string;
    planta: string;
    data_planejada: string;
};

export const getMaintenancesByDate = async (
    dataReferencia: string
): Promise<MaintenanceDbRow[]> => {
    const client = getMaintPool();
    const table = String(process.env.MAINT_DB_TABLE || 'manutencoes').trim();

    const result = await client.query(
        `SELECT
            titulo,
            placa,
            status,
            planta,
            data_planejada::date AS data_planejada
        FROM ${table}
        WHERE data_planejada::date = $1::date
        ORDER BY placa, titulo`,
        [dataReferencia]
    );
    return result.rows as MaintenanceDbRow[];
};

export const closeMaintPool = async (): Promise<void> => {
    if (maintPool) {
        await maintPool.end();
        maintPool = null;
    }
};

/* ── Rotas Pendentes (APBD / faturamento.Rota) ──────────── */

let rotasPendPool: pg.Pool | null = null;

const getRotasPendPool = (): pg.Pool => {
    if (rotasPendPool) return rotasPendPool;

    const dbUrl = String(process.env.ROTAS_PEND_DB_URL || '').trim();
    if (!dbUrl) {
        throw new Error('ROTAS_PEND_DB_URL não configurada');
    }

    const ssl = String(process.env.ROTAS_PEND_DB_SSL || 'true').trim().toLowerCase();
    const schema = String(process.env.ROTAS_PEND_DB_SCHEMA || 'public').trim();

    rotasPendPool = new Pool({
        connectionString: dbUrl,
        ssl: ssl === 'true' || ssl === '1' ? { rejectUnauthorized: false } : undefined,
        max: 3,
        idleTimeoutMillis: 15_000,
        connectionTimeoutMillis: 8_000
    });

    rotasPendPool.on('connect', (client) => {
        client.query(`SET search_path TO ${schema}`);
    });

    return rotasPendPool;
};

export const getRotasPendentesCount = async (
    plantIds: number[] = []
): Promise<number> => {
    const pool = getRotasPendPool();
    const schema = String(process.env.ROTAS_PEND_DB_SCHEMA || 'public').trim();
    const table = String(process.env.ROTAS_PEND_DB_TABLE || 'Rota').trim();
    // Quote identifiers to preserve case (PostgreSQL folds to lowercase without quotes)
    const fqn = `"${schema}"."${table}"`;

    const client = await pool.connect();
    try {
        const since = new Date();
        since.setDate(since.getDate() - 30);

        if (plantIds.length === 0) {
            const result = await client.query(
                `SELECT COUNT(*)::int AS total FROM ${fqn} WHERE status IS NOT NULL AND UPPER(status) <> 'ENCERRADO' AND "dtInicio" >= $1::timestamp`,
                [since.toISOString()]
            );
            return result.rows[0]?.total ?? 0;
        }

        const intPlantIds = plantIds.map(id => Number(id)).filter(Number.isFinite);
        const placeholders = intPlantIds.map((_, i) => `$${i + 2}::int`).join(',');
        const result = await client.query(
            `SELECT COUNT(*)::int AS total FROM ${fqn} WHERE status IS NOT NULL AND UPPER(status) <> 'ENCERRADO' AND "dtInicio" >= $1::timestamp AND "plantaId" = ANY(ARRAY[${placeholders}])`,
            [since.toISOString(), ...intPlantIds]
        );
        return result.rows[0]?.total ?? 0;
    } finally {
        client.release();
    }
};

export const closeRotasPendPool = async (): Promise<void> => {
    if (rotasPendPool) {
        await rotasPendPool.end();
        rotasPendPool = null;
    }
};

/* ── CCO Painel (checklist_web DB — departures / non_collections / operacao_config) ── */

let ccoPool: pg.Pool | null = null;

const getCcoPool = (): pg.Pool => {
    if (ccoPool) return ccoPool;

    const dbUrl = String(process.env.CCO_DB_URL || '').trim();
    if (!dbUrl) {
        throw new Error('CCO_DB_URL não configurada');
    }

    const ssl = String(process.env.CCO_DB_SSL || 'true').trim().toLowerCase();
    const schema = String(process.env.CCO_DB_SCHEMA || 'public').trim();

    ccoPool = new Pool({
        connectionString: dbUrl,
        ssl: ssl === 'true' || ssl === '1' ? { rejectUnauthorized: false } : undefined,
        max: 5,
        idleTimeoutMillis: 15_000,
        connectionTimeoutMillis: 8_000
    });

    ccoPool.on('connect', (client) => {
        client.query(`SET search_path TO ${schema}`);
    });

    return ccoPool;
};

/* ── Departures (Saídas de Rotas) ── */

export type DepartureRow = {
    id: number;
    operacao: string;
    rota: string | null;
    motorista: string | null;
    placa_veiculo: string | null;
    celular_motorista: string | null;
    hora_prevista: string | null;
    hora_saida: string | null;
    status_saida: string | null;
    motivo_atraso: string | null;
    observacao: string | null;
    data_operacao: string;
    celula: string | null;
    status_rota: string | null;
    tipo_veiculo: string | null;
    km: string | null;
    conferente: string | null;
    tipo_servico: string | null;
    regional: string | null;
    base: string | null;
    turno: string | null;
    rota_origem: string | null;
    total_pacotes: number | null;
    checklist_motorista: string | null;
    retorno_motorista: string | null;
    causa_raiz: string | null;
    tempo_resposta: string | null;
    log_tempo_resposta: string | null;
};

export const getDeparturesByDate = async (
    dataReferencia: string
): Promise<DepartureRow[]> => {
    const pool = getCcoPool();
    const result = await pool.query(
        `SELECT * FROM departures WHERE data_operacao = $1::date ORDER BY id`,
        [dataReferencia]
    );
    return result.rows as DepartureRow[];
};

/* ── Non Collections (Não Coletas) ── */

export type NonCollectionRow = {
    id: number;
    operacao: string;
    data_operacao: string;
    rota: string | null;
    status: string | null;
    quantidade: number | null;
    observacao: string | null;
    celula: string | null;
    regional: string | null;
    base: string | null;
    turno: string | null;
    tipo_ocorrencia: string | null;
    responsavel: string | null;
    previsto: string | null;
    semana: string | null;
    data: string | null;
    codigo: string | null;
    produtor: string | null;
    motivo: string | null;
    acao: string | null;
    data_acao: string | null;
    ultima_coleta: string | null;
    culpabilidade: string | null;
    causa_raiz: string | null;
};

export const getNonCollectionsByDate = async (
    dataReferencia: string
): Promise<NonCollectionRow[]> => {
    const pool = getCcoPool();
    const result = await pool.query(
        `SELECT * FROM non_collections WHERE data_operacao = $1::date ORDER BY id`,
        [dataReferencia]
    );
    return result.rows as NonCollectionRow[];
};

/* ── Operação Config (Config de Operações) ── */

export type OperacaoConfigRow = {
    id: number;
    operacao: string;
    email: string | null;
    tolerancia: string | null;
    nome_exibicao: string | null;
    plant_id: string | null;
    datalake_plant_id: string | null;
    status: string | null;
    envio: string | null;
    copia: string | null;
    conteudo: string | null;
    conteudo_ncoletas: string | null;
};

export const getOperacaoConfigs = async (): Promise<OperacaoConfigRow[]> => {
    const pool = getCcoPool();
    const result = await pool.query(
        `SELECT * FROM operacao_config ORDER BY operacao`
    );
    return result.rows as OperacaoConfigRow[];
};

/* ── Coletas Previstas (agregado de non_collections) ── */

export type ColetaPrevistaRow = {
    operacao: string;
    qnt_coletas: number;
};

export const getColetasPrevistasByDate = async (
    dataReferencia: string
): Promise<ColetaPrevistaRow[]> => {
    const pool = getCcoPool();
    const result = await pool.query(
        `SELECT
            operacao,
            COALESCE(SUM(quantidade), 0)::int AS qnt_coletas
        FROM non_collections
        WHERE data_operacao = $1::date
        GROUP BY operacao
        ORDER BY operacao`,
        [dataReferencia]
    );
    return result.rows as ColetaPrevistaRow[];
};

export const closeCcoPool = async (): Promise<void> => {
    if (ccoPool) {
        await ccoPool.end();
        ccoPool = null;
    }
};
