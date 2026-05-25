import { FilialConfig, RotaSaida } from '../types';

const SHAREPOINT_API_BASE = 'https://vialacteoscombr.sharepoint.com/sites/CCO/_api';
const CONFIG_LIST_URL_DEFAULT = `${SHAREPOINT_API_BASE}/web/Lists(guid'29974ead-992b-47c9-ac1b-74b9535416ff')/Items`;
const ROTAS_LIST_URL_BASE_DEFAULT =
  `${SHAREPOINT_API_BASE}/web/GetList(%27/sites/CCO/Lists/Dados_Saida_de_rotas%27)/items`;

const MAX_CONFIG_PAGES = 3;
const MAX_ROTAS_PAGES = 8;

const stripAccents = (value: string): string =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export const normalizeOperation = (value: string): string =>
  stripAccents(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

const toIsoDay = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const buildRotasUrl = (referenceDate: Date): string => {
  const start = new Date(referenceDate.getTime());
  start.setHours(0, 0, 0, 0);

  const end = new Date(start.getTime());
  end.setDate(end.getDate() + 1);

  const startIso = `${toIsoDay(start)}T00:00:00Z`;
  const endIso = `${toIsoDay(end)}T00:00:00Z`;
  const filter = `DataOperacao ge datetime'${startIso}' and DataOperacao lt datetime'${endIso}'`;

  return `${ROTAS_LIST_URL_BASE_DEFAULT}?$filter=${encodeURIComponent(filter)}&$orderby=ID desc`;
};

interface ParsedFeed {
  entries: Element[];
  nextUrl: string | null;
}

const parseFeed = (xmlText: string, baseUrl: string): ParsedFeed => {
  const xml = new DOMParser().parseFromString(xmlText, 'application/xml');
  const parseErrors = xml.getElementsByTagName('parsererror');
  if (parseErrors.length > 0) {
    throw new Error('Resposta XML invalida da lista do SharePoint.');
  }

  const entries = Array.from(xml.getElementsByTagNameNS('*', 'entry'));
  const links = Array.from(xml.getElementsByTagNameNS('*', 'link'));
  const nextHref = links.find((link) => link.getAttribute('rel') === 'next')?.getAttribute('href');
  const nextUrl = nextHref ? new URL(nextHref, baseUrl).toString() : null;

  return { entries, nextUrl };
};

const findFirstByLocalName = (parent: Element, localName: string): Element | null =>
  Array.from(parent.getElementsByTagNameNS('*', localName))[0] ?? null;

const readField = (entry: Element, fieldName: string): string | null => {
  const properties = findFirstByLocalName(entry, 'properties');
  if (!properties) return null;

  const field = Array.from(properties.children).find((node) => node.localName === fieldName);
  if (!field) return null;

  const raw = field.textContent?.trim() ?? '';
  return raw.length > 0 ? raw : null;
};

const parseFiliais = (entries: Element[]): FilialConfig[] => {
  const unique = new Map<string, FilialConfig>();

  entries.forEach((entry) => {
    const operacao = readField(entry, 'OPERACAO');
    if (!operacao) return;

    const key = normalizeOperation(operacao);
    if (key.length === 0 || unique.has(key)) return;

    unique.set(key, {
      id: key,
      operacao,
      nomeExibicao: readField(entry, 'NomeExibicao') ?? operacao,
      email: readField(entry, 'EMAIL'),
      tolerancia: readField(entry, 'TOLERANCIA')
    });
  });

  return Array.from(unique.values()).sort((a, b) =>
    a.nomeExibicao.localeCompare(b.nomeExibicao, 'pt-BR', { sensitivity: 'base' })
  );
};

const parseRotas = (entries: Element[]): RotaSaida[] => {
  const parsed = entries
    .map((entry) => {
      const id = readField(entry, 'ID') ?? readField(entry, 'Id');
      const operacao = readField(entry, 'Operacao');
      if (!id || !operacao) return null;

      return {
        id,
        title: readField(entry, 'Title') ?? `ROTA ${id}`,
        operacao,
        horarioInicio: readField(entry, 'HorarioInicio'),
        horarioSaida: readField(entry, 'HorarioSaida'),
        motorista: readField(entry, 'Motorista'),
        placa: readField(entry, 'Placa'),
        statusGeral: readField(entry, 'StatusGeral'),
        statusOp: readField(entry, 'StatusOp'),
        aviso: readField(entry, 'Aviso')
      } as RotaSaida;
    })
    .filter((entry): entry is RotaSaida => entry !== null);

  parsed.sort((a, b) => Number(a.id) - Number(b.id));
  return parsed;
};

const fetchFeedEntries = async (url: string, maxPages: number): Promise<Element[]> => {
  const entries: Element[] = [];
  let nextUrl: string | null = url;
  let pageCount = 0;

  while (nextUrl && pageCount < maxPages) {
    const response = await fetch(nextUrl, {
      method: 'GET',
      credentials: 'include',
      headers: {
        Accept: 'application/atom+xml',
        'Content-Type': 'application/atom+xml'
      }
    });

    if (!response.ok) {
      throw new Error(`Falha ao consultar SharePoint (${response.status}).`);
    }

    const xmlText = await response.text();
    const parsed = parseFeed(xmlText, nextUrl);

    entries.push(...parsed.entries);
    nextUrl = parsed.nextUrl;
    pageCount += 1;
  }

  return entries;
};

export interface SharePointData {
  filiais: FilialConfig[];
  rotas: RotaSaida[];
}

export const loadSharePointData = async (): Promise<SharePointData> => {
  const configUrl = import.meta.env.VITE_SHAREPOINT_CONFIG_URL?.trim() || CONFIG_LIST_URL_DEFAULT;
  const rotasUrl =
    import.meta.env.VITE_SHAREPOINT_ROTAS_URL?.trim() || buildRotasUrl(new Date());

  const [configEntries, rotaEntries] = await Promise.all([
    fetchFeedEntries(configUrl, MAX_CONFIG_PAGES),
    fetchFeedEntries(rotasUrl, MAX_ROTAS_PAGES)
  ]);

  return {
    filiais: parseFiliais(configEntries),
    rotas: parseRotas(rotaEntries)
  };
};
