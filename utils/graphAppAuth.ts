/**
 * Server-side Microsoft Graph API authentication via Azure AD Client Credentials flow.
 * Used by Vercel serverless functions that have no user session.
 */

import fs from 'node:fs';
import path from 'node:path';

const readEnvFromDotEnvFiles = (name: string): string => {
    const candidates = ['.env.local', '.env'];
    for (const file of candidates) {
        const fullPath = path.join(process.cwd(), file);
        if (!fs.existsSync(fullPath)) continue;
        const content = fs.readFileSync(fullPath, 'utf-8');
        for (const rawLine of content.split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;
            const eqIndex = line.indexOf('=');
            if (eqIndex <= 0) continue;
            const key = line.slice(0, eqIndex).trim().replace(/^export\s+/i, '');
            if (key !== name) continue;
            return line.slice(eqIndex + 1).trim().replace(/^['"]|['"]$/g, '').trim();
        }
    }
    return '';
};

const readEnv = (name: string): string => {
    const fromProcess = String(process.env[name] || '').trim();
    const fromDotEnv = readEnvFromDotEnvFiles(name);
    return fromDotEnv || fromProcess;
};

const readRequiredEnv = (name: string): string => {
    const value = readEnv(name);
    if (!value) throw new Error(`${name} não configurada`);
    return value;
};

let cachedToken: { token: string; expiresAt: number } | null = null;
const TOKEN_BUFFER_MS = 60_000;

export const getGraphAppToken = async (): Promise<string> => {
    if (cachedToken && Date.now() < cachedToken.expiresAt) {
        return cachedToken.token;
    }

    const clientId = readRequiredEnv('VITE_AZURE_CLIENT_ID');
    const clientSecret = readRequiredEnv('VITE_AZURE_CLIENT_SECRET');
    const tenantId = readRequiredEnv('VITE_AZURE_TENANT_ID');

    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials'
    }).toString();

    const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Graph token error ${response.status}: ${text.slice(0, 400)}`);
    }

    const data = await response.json();
    const token = String(data.access_token || '').trim();
    if (!token) throw new Error('Token vazio na resposta do Azure AD');

    const expiresIn = Number(data.expires_in || 3600);
    cachedToken = { token, expiresAt: Date.now() + expiresIn * 1000 - TOKEN_BUFFER_MS };

    console.log('[GRAPH_APP_AUTH] Token obtido, expira em', expiresIn, 's');
    return token;
};

const graphAppFetch = async (endpoint: string, token: string): Promise<any> => {
    const url = endpoint.startsWith('https://')
        ? endpoint
        : `https://graph.microsoft.com/v1.0${endpoint}`;

    const res = await fetch(url, {
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        }
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Graph API ${res.status}: ${text.slice(0, 400)}`);
    }

    return res.status === 204 ? null : res.json();
};

const normalizeString = (str: string): string =>
    str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '').trim();

const resolveFieldName = (mapping: Record<string, string>, target: string): string => {
    const normalized = normalizeString(target);
    return mapping[normalized] || target;
};

const parseNumericId = (value: unknown): number | null => {
    if (value == null) return null;
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    const raw = String(value).trim();
    if (!raw) return null;
    const match = raw.match(/-?\d+(?:[.,]\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0].replace(',', '.'));
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
};

const extractPlantFieldValue = (fields: Record<string, any>, mapping: Record<string, string>): any => {
    const candidates = [
        'Plant_id', 'Plant Id', 'PlantId', 'plant_id', 'IdPlant', 'ID_PLANT'
    ].map((c) => resolveFieldName(mapping, c));

    for (const candidate of candidates) {
        if (!candidate) continue;
        const value = fields?.[candidate];
        if (value != null && String(value).trim() !== '') return value;
    }

    for (const [key, value] of Object.entries(fields || {})) {
        const normalizedKey = normalizeString(key);
        if (normalizedKey.includes('plantid') || normalizedKey.includes('idplant')) {
            if (value != null && String(value).trim() !== '') return value;
        }
    }

    return null;
};

const getListColumnMapping = async (siteId: string, listId: string, token: string): Promise<Record<string, string>> => {
    const columns = await graphAppFetch(`/sites/${siteId}/lists/${listId}/columns`, token);
    const mapping: Record<string, string> = {};
    for (const col of columns.value || []) {
        mapping[normalizeString(col.name)] = col.name;
        mapping[normalizeString(col.displayName)] = col.name;
    }
    return mapping;
};

export type PlantConfig = {
    plantId: number;
    operacao: string;
    filial: string;
};

export const getPlantConfigsFromSharePoint = async (): Promise<PlantConfig[]> => {
    const sitePath = readEnv('VITE_SHAREPOINT_SITE_PATH');
    if (!sitePath) throw new Error('VITE_SHAREPOINT_SITE_PATH não configurada');

    const token = await getGraphAppToken();

    const siteData = await graphAppFetch(`/sites/${sitePath}`, token);
    const siteId = siteData.id;

    let list: any;
    try {
        list = await graphAppFetch(`/sites/${siteId}/lists/CONFIG_OPERACAO_SAIDA_DE_ROTAS`, token);
    } catch {
        const listsData = await graphAppFetch(`/sites/${siteId}/lists`, token);
        list = (listsData.value || []).find(
            (l: any) =>
                l.name?.toLowerCase() === 'config_operacao_saida_de_rotas' ||
                l.displayName?.toLowerCase() === 'config_operacao_saida_de_rotas'
        );
        if (!list) throw new Error('Lista CONFIG_OPERACAO_SAIDA_DE_ROTAS não encontrada');
    }

    const mapping = await getListColumnMapping(siteId, list.id, token);

    const data = await graphAppFetch(
        `/sites/${siteId}/lists/${list.id}/items?expand=fields`,
        token
    );

    const configs: PlantConfig[] = [];

    for (const item of data.value || []) {
        const f = item.fields || {};
        const operacao = String(f[resolveFieldName(mapping, 'OPERACAO')] || '').trim();
        if (!operacao) continue;

        const plantRaw = extractPlantFieldValue(f, mapping);
        const plantId = parseNumericId(plantRaw);
        if (plantId == null) continue;

        const filial = String(
            f[resolveFieldName(mapping, 'NomeExibicao')] || operacao
        ).trim();

        configs.push({ plantId, operacao, filial });
    }

    console.log(`[SHAREPOINT_CONFIG] ${configs.length} plant configs obtidas`);
    return configs;
};
