import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FilialConfig, KPIData } from './types';
import {
    fetchPlantConfigs,
    fetchSaidasRotas,
    fetchNaoColetasMotivos,
    fetchColetasPrevistas,
    fetchMaintenances,
    fetchRotasPendentesCount,
    fetchProdutoresSemColeta,
    type PlantConfig,
    type SaidaRotaItem,
    type NaoColetaItem,
    type ColetaPrevistaItem,
    type MaintenanceItem,
    type ProdutorSemColetaItem
} from './services/routeWebService';
import logoImg from './assets/logo.png';
import './styles/global.css';

/* ── helpers ──────────────────────────────────────────────────── */
const timelineMarks = [0, 6, 12, 18, 24];
const oneMinuteMs = 60_000;
const ROTATE_INTERVAL_MS = 60_000;
const toPercent = (h: number) => (h / 24) * 100;

const normalizeOperation = (v: string) =>
    v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const getNowHour = () => {
    const d = new Date();
    return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
};

const parseClockToMinutes = (c: string | null | undefined): number | null => {
    if (!c) return null;
    const raw = String(c).trim();
    // Try "HH:MM" format first
    let m = /^(\d{1,2}):(\d{2})/.exec(raw);
    if (m) {
        const h = Number(m[1]), mi = Number(m[2]);
        if (!isNaN(h) && !isNaN(mi) && h <= 23 && mi <= 59) return h * 60 + mi;
    }
    // Try ISO datetime format "2025-01-15T08:30:00..."
    m = /T(\d{1,2}):(\d{2})/.exec(raw);
    if (m) {
        const h = Number(m[1]), mi = Number(m[2]);
        if (!isNaN(h) && !isNaN(mi) && h <= 23 && mi <= 59) return h * 60 + mi;
    }
    return null;
};

const parseClockToHour = (c: string | null | undefined): number | null => {
    const mins = parseClockToMinutes(c);
    return mins !== null ? mins / 60 : null;
};

const formatTimeDelta = (minutes: number): string => {
    if (minutes < 0) return `atrasada ${Math.abs(minutes)} min`;
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m > 0 ? `${h}h${String(m).padStart(2, '0')}min` : `${h}h`;
};

const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/* ── count-up animation hook ──────────────────────────────────── */
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

function useCountUp(target: number, duration = 800): number {
    const [display, setDisplay] = useState(target);
    const fromRef = useRef(target);
    const rafRef = useRef(0);
    const startRef = useRef(0);

    useEffect(() => {
        const from = fromRef.current;
        fromRef.current = target;
        startRef.current = performance.now();

        const tick = (now: number) => {
            const elapsed = now - startRef.current;
            const progress = Math.min(elapsed / duration, 1);
            const eased = easeOutCubic(progress);
            const current = from + (target - from) * eased;
            setDisplay(current);
            if (progress < 1) {
                rafRef.current = requestAnimationFrame(tick);
            }
        };

        if (from === target) {
            setDisplay(target);
            return;
        }

        rafRef.current = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(rafRef.current);
    }, [target, duration]);

    return display;
}

/* ── animated number display ──────────────────────────────────── */
const AnimatedNumber = ({ value, decimals = 0, suffix = '' }: { value: number; decimals?: number; suffix?: string }) => {
    const animated = useCountUp(value, 800);
    return <>{animated.toFixed(decimals)}{suffix}</>;
};

/* ── URL-based filter mode ────────────────────────────────────── */
const getFilterModeFromURL = (): 'operacao' | 'celula' => {
    const path = window.location.pathname.replace(/\/+$/, '');
    if (path.endsWith('/celula')) return 'celula';
    return 'operacao'; // default: /filial or /
};

/* ── types ────────────────────────────────────────────────────── */
interface CelulaGroup {
    index: number;
    label: string;
    email: string;
    filiais: FilialConfig[];
    plantIds: number[];
}

type FilterMode = 'operacao' | 'celula';

/* ── KPI threshold helper ─────────────────────────────────────── */
const kpiThreshold = (value: number, kind: 'pct' | 'count'): string => {
    if (kind === 'count') return value > 0 ? 'kpi-bad' : 'kpi-good';
    if (value >= 80) return 'kpi-good';
    if (value >= 50) return 'kpi-warn';
    return 'kpi-bad';
};

const kpiBarClass = (value: number, kind: 'pct' | 'count'): string => {
    if (kind === 'count') return value > 0 ? 'bar-red' : 'bar-green';
    if (value >= 80) return 'bar-green';
    if (value >= 50) return 'bar-amber';
    return 'bar-red';
};

/* ── Route timeline bar color — STATUS-BASED only ── */
type RouteBarColor = 'gray' | 'blue' | 'yellow' | 'red';

const getRouteBarColor = (s: SaidaRotaItem): RouteBarColor => {
    const st = (s.statusOp || '').toUpperCase().trim();

    // 1) ATRASADA / ADIANTADA with all info filled → red
    if (st.includes('ATRAS') || st.includes('ADIANT')) {
        const hasMotivo = !!s.motivoAtraso && s.motivoAtraso.trim() !== '';
        const hasObs = !!s.observacao && s.observacao.trim() !== '';
        const hasInicio = !!s.horarioInicio && s.horarioInicio.trim() !== '';
        if (hasMotivo && hasObs && hasInicio) return 'red';
        return 'yellow'; // missing info → pending verification
    }

    // 2) NO PRAZO → blue (OK)
    if (st.includes('NO PRAZO')) return 'blue';

    // 3) PROGRAMADA / PREVISTA / no status → gray
    if (!st || st.includes('PROGRAMAD') || st.includes('PREVIST') || st.includes('PREVISTA')) return 'gray';

    // 4) Already departed (has horarioInicio) but no explicit status → blue
    const hasInicio = !!s.horarioInicio && s.horarioInicio.trim() !== '';
    if (hasInicio) return 'blue';

    // 5) Default: gray (prevista / aguardando)
    return 'gray';
};

/** Returns the route's reference time in minutes-from-midnight for sorting/positioning.
 *  Uses horarioSaida when available; otherwise falls back to horarioInicio.
 *  Returns null only if neither exists. */
const getRouteRefMinutes = (s: SaidaRotaItem): number | null => {
    const saida = parseClockToMinutes(s.horarioSaida);
    if (saida !== null) return saida;
    return parseClockToMinutes(s.horarioInicio);
};

/* ================================================================
   DASHBOARD COMPONENT
   ================================================================ */
export function Dashboard(): JSX.Element {
    const [filiais, setFiliais] = useState<FilialConfig[]>([]);
    const [saidasRotas, setSaidasRotas] = useState<SaidaRotaItem[]>([]);
    const [naoColetasData, setNaoColetasData] = useState<NaoColetaItem[]>([]);
    const [coletasPrevistas, setColetasPrevistas] = useState<ColetaPrevistaItem[]>([]);
    const [maintenances, setMaintenances] = useState<MaintenanceItem[]>([]);
    const [activeFilialIndex, setActiveFilialIndex] = useState(0);
    const [activeCelulaIndex, setActiveCelulaIndex] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [nowHour, setNowHour] = useState(getNowHour);
    const [filterMode, setFilterMode] = useState<FilterMode>(getFilterModeFromURL);
    const [timeLeft, setTimeLeft] = useState(ROTATE_INTERVAL_MS / 1000);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [rotasPendentesCount, setRotasPendentesCount] = useState(0);
    const [produtoresSemColeta, setProdutoresSemColeta] = useState<ProdutorSemColetaItem[]>([]);

    const tableWrapRef = useRef<HTMLDivElement>(null);
    const chartAreaRef = useRef<HTMLDivElement>(null);
    const timelineRowsRef = useRef<HTMLDivElement>(null);

    /* ── derived state ── */
    const celulas = useMemo<CelulaGroup[]>(() => {
        const emailMap = new Map<string, FilialConfig[]>();
        for (const f of filiais) {
            const e = (f.email || '').trim().toLowerCase();
            if (!e) continue;
            if (!emailMap.has(e)) emailMap.set(e, []);
            emailMap.get(e)!.push(f);
        }
        return Array.from(emailMap.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .filter((_, idx) => idx !== 3) // ignora Célula 4
            .map(([email, fils], idx) => ({
                index: idx + 1,
                label: `CÉLULA ${idx + 1}`,
                email,
                filiais: fils,
                plantIds: fils.map(f => f.plantId!).filter((id): id is number => id != null),
            }));
    }, [filiais]);

    const activeFilial = filiais[activeFilialIndex] ?? null;
    const activeCelula = celulas[activeCelulaIndex] ?? null;
    const shouldRotate = filterMode === 'celula' ? celulas.length > 1 : filiais.length > 1;

    /* ── data loading ── */
    const loadData = useCallback(async () => {
        try {
            setError(null);
            const [plantConfigs, saidas, naoColetas, previstas, maint] = await Promise.all([
                fetchPlantConfigs(),
                fetchSaidasRotas(todayISO()),
                fetchNaoColetasMotivos(todayISO()),
                fetchColetasPrevistas(todayISO()),
                fetchMaintenances(todayISO()).catch(err => {
                    console.warn('[DASHBOARD] Manutenções indisponíveis:', err?.message || err);
                    return [] as MaintenanceItem[];
                }),
            ]);
            const fc: FilialConfig[] = plantConfigs.map((pc: PlantConfig) => ({
                id: normalizeOperation(pc.operacao),
                operacao: pc.operacao,
                nomeExibicao: pc.filial,
                plantId: pc.plantId,
                email: pc.email,
            }));
            fc.sort((a, b) => a.nomeExibicao.localeCompare(b.nomeExibicao, 'pt-BR', { sensitivity: 'base' }));
            setFiliais(fc);
            setSaidasRotas(saidas);
            setNaoColetasData(naoColetas);
            setColetasPrevistas(previstas);
            setMaintenances(maint);
            setActiveFilialIndex(prev => fc.length > 0 ? prev % fc.length : 0);
            setLastUpdate(new Date());


            // Fetch produtores sem coleta
            fetchProdutoresSemColeta().then(rows => {
                setProdutoresSemColeta(rows);
            }).catch(err => {
                console.warn('[DASHBOARD] Produtores sem coleta indisponíveis:', err?.message || err);
            });

            // Fade out splash after first successful data load
            const splash = document.getElementById('splash');
            if (splash) {
                splash.classList.add('hide');
                setTimeout(() => splash.remove(), 1000);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Não foi possível carregar os dados.');
            console.error('[DASHBOARD] Erro loadData:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadData();
        const id = window.setInterval(() => void loadData(), oneMinuteMs);
        return () => window.clearInterval(id);
    }, [loadData]);

    useEffect(() => {
        const id = window.setInterval(() => setNowHour(getNowHour()), 15_000);
        return () => window.clearInterval(id);
    }, []);

    /* ── rotation + countdown ── */
    useEffect(() => {
        if (!shouldRotate) { setTimeLeft(0); return; }
        setTimeLeft(ROTATE_INTERVAL_MS / 1000);
        const cd = window.setInterval(() => setTimeLeft(p => Math.max(p - 1, 0)), 1000);
        const rt = window.setTimeout(() => {
            if (filterMode === 'celula') setActiveCelulaIndex(p => (p + 1) % celulas.length);
            else setActiveFilialIndex(p => (p + 1) % filiais.length);
        }, ROTATE_INTERVAL_MS);
        return () => { window.clearInterval(cd); window.clearTimeout(rt); };
    }, [activeFilialIndex, activeCelulaIndex, filterMode, celulas.length, filiais.length, shouldRotate]);

    /* ── rotas pendentes: refetch when active filial/célula changes ── */
    useEffect(() => {
        let cancelled = false;
        const plantIds = filterMode === 'celula' && activeCelula
            ? activeCelula.plantIds.filter((id): id is number => id != null)
            : activeFilial && activeFilial.plantId != null
                ? [activeFilial.plantId]
                : filiais.map(f => f.plantId).filter((id): id is number => id != null);

        if (plantIds.length > 0) {
            fetchRotasPendentesCount(plantIds).then(count => {
                if (!cancelled) setRotasPendentesCount(count);
            }).catch(err => {
                console.warn('[DASHBOARD] Rotas pendentes indisponíveis:', err?.message || err);
            });
        } else {
            setRotasPendentesCount(0);
        }
        return () => { cancelled = true; };
    }, [activeFilial, activeCelula, filterMode, filiais]);

    /* ── computed data ── */
    const saidasFilial = useMemo(() => {
        if (filterMode === 'celula') {
            if (!activeCelula) return [];
            const ops = new Set(activeCelula.filiais.map(f => normalizeOperation(f.operacao)));
            return saidasRotas.filter(s => ops.has(normalizeOperation(s.operacao)));
        }
        if (!activeFilial || !activeFilial.operacao) return [];
        const op = normalizeOperation(activeFilial.operacao);
        return saidasRotas.filter(s => normalizeOperation(s.operacao) === op);
    }, [saidasRotas, activeFilial, activeCelula, filterMode]);

    /* ── próxima rota prevista (modo célula) ── */
    const proximaRota = useMemo<{ title: string; deltaMin: number; label: string } | null>(() => {
        if (filterMode !== 'celula') return null;
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

        const previstas = saidasFilial.filter(s => {
            const stUpper = (s.statusOp || '').toUpperCase();
            if (stUpper.includes('ATRAS') || stUpper.includes('ADIANT') || stUpper.includes('NO PRAZO')) return false;
            if (!s.horarioSaida) return false;
            const saidaMin = parseClockToMinutes(s.horarioSaida);
            if (saidaMin === null) return false;
            return saidaMin > nowMin;
        });

        if (previstas.length === 0) return null;

        previstas.sort((a, b) => {
            const aMin = parseClockToMinutes(a.horarioSaida)!;
            const bMin = parseClockToMinutes(b.horarioSaida)!;
            return aMin - bMin;
        });

        const next = previstas[0];
        const saidaMin = parseClockToMinutes(next.horarioSaida)!;
        const deltaMin = saidaMin - nowMin;
        return { title: next.title, deltaMin, label: formatTimeDelta(deltaMin) };
    }, [saidasFilial, filterMode, nowHour]);

    const saidasCelula = useMemo(() => {
        if (filterMode !== 'celula') return saidasFilial;
        return [...saidasFilial].sort((a, b) => {
            const aPrevista = !(a.statusOp || '').toUpperCase().match(/ATRAS|ADIANT|NO PRAZO/);
            const bPrevista = !(b.statusOp || '').toUpperCase().match(/ATRAS|ADIANT|NO PRAZO/);
            if (aPrevista && !bPrevista) return -1;
            if (!aPrevista && bPrevista) return 1;
            const aMin = parseClockToMinutes(a.horarioSaida) ?? 9999;
            const bMin = parseClockToMinutes(b.horarioSaida) ?? 9999;
            return aMin - bMin;
        });
    }, [saidasFilial, filterMode]);

    const indicadores = useMemo<KPIData[]>(() => {
        if (saidasFilial.length === 0 && (!activeFilial || !activeCelula)) return [
            { id: 'sla-saidas', label: 'Atendimento Saídas', value: 0, kind: 'gauge', accent: 'blue' },
            { id: 'sla-ncol', label: 'Atendimento N Coletas', value: 0, kind: 'gauge', accent: 'blue-red' },
        ];

        const totalSaidas = saidasFilial.length;

        // Só desconta do indicador se motivo for interno: Mão de obra, Manutenção ou Logística
        const motivosInternos = ['MAO DE OBRA', 'MÃO DE OBRA', 'MANUTENCAO', 'MANUTENÇÃO', 'LOGISTICA', 'LOGÍSTICA'];
        const isMotivoInterno = (motivo: string | null): boolean => {
            if (!motivo) return false;
            const norm = motivo.toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            return motivosInternos.some(m => norm.includes(m));
        };

        const atrasadasQueDescontam = saidasFilial.filter(s => {
            const st = (s.statusOp || '').toUpperCase();
            return st.includes('ATRAS') && isMotivoInterno(s.motivoAtraso);
        }).length;
        const adiantadas = saidasFilial.filter(s => {
            const st = (s.statusOp || '').toUpperCase();
            return st.includes('ADIANT');
        }).length;
        const rotasOk = totalSaidas - atrasadasQueDescontam - adiantadas;
        const atendSaidas = totalSaidas > 0 ? (rotasOk / totalSaidas) * 100 : 0;

        const opsSet = filterMode === 'celula' && activeCelula
            ? new Set(activeCelula.filiais.map(f => normalizeOperation(f.operacao)))
            : filterMode === 'operacao' && activeFilial && activeFilial.operacao
                ? new Set([normalizeOperation(activeFilial.operacao)])
                : new Set<string>();

        const totalQntColetas = coletasPrevistas
            .filter(cp => opsSet.has(normalizeOperation(cp.operacao)))
            .reduce((sum, cp) => sum + cp.qntColetas, 0);

        const naoColetasInternas = naoColetasData
            .filter(nc => opsSet.has(normalizeOperation(nc.operacao)) && nc.culpabilidade.toUpperCase() === 'VIA')
            .length;

        const coletasAtendidas = totalQntColetas - naoColetasInternas;
        const atendNColetas = totalQntColetas > 0
            ? (coletasAtendidas / totalQntColetas) * 100
            : naoColetasInternas > 0 ? 0 : 100;

        return [
            { id: 'sla-saidas', label: 'Atendimento Saídas', value: atendSaidas, kind: 'gauge', accent: 'blue' },
            { id: 'sla-ncol', label: 'Atendimento N Coletas', value: atendNColetas, kind: 'gauge', accent: 'blue-red' },
        ];
    }, [saidasFilial, naoColetasData, coletasPrevistas, activeFilial, activeCelula, filterMode]);

    const parseDateFlexible = (raw: string): Date | null => {
        if (!raw) return null;
        const s = raw.trim();
        // DD/MM/AAAA or DD/MM/AAAA HH:mm
        const brMatch = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
        if (brMatch) return new Date(+brMatch[3], +brMatch[2] - 1, +brMatch[1]);
        // AAAA-MM-DD or ISO datetime
        const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (isoMatch) return new Date(+isoMatch[1], +isoMatch[2] - 1, +isoMatch[3]);
        // fallback
        const d = new Date(s);
        return isNaN(d.getTime()) ? null : d;
    };

    const produtoresChart = useMemo(() => {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);

        const opsSet = filterMode === 'celula' && activeCelula
            ? new Set(activeCelula.filiais.map(f => normalizeOperation(f.operacao)))
            : filterMode === 'operacao' && activeFilial && activeFilial.operacao
                ? new Set([normalizeOperation(activeFilial.operacao)])
                : null;

        const unique = new Map<string, typeof produtoresSemColeta[number] & { dias_sem_coleta: number }>();
        for (const p of produtoresSemColeta) {
            if (opsSet && !opsSet.has(normalizeOperation(p.operacao))) continue;
            let dias = 999;
            const dt = parseDateFlexible(p.ultima_coleta || '');
            if (dt) {
                const dtDate = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
                dias = Math.floor((hoje.getTime() - dtDate.getTime()) / (1000 * 60 * 60 * 24));
            }
            if (dias > 30) continue;
            const key = `${p.codigo}-${p.operacao}`;
            const existing = unique.get(key);
            if (!existing || dias < existing.dias_sem_coleta) {
                unique.set(key, { ...p, dias_sem_coleta: dias });
            }
        }
        return Array.from(unique.values())
            .filter(p => p.dias_sem_coleta >= 2)
            .sort((a, b) => b.dias_sem_coleta - a.dias_sem_coleta);
    }, [produtoresSemColeta, activeFilial, activeCelula, filterMode]);

    /* ── Timeline routes sorted: earliest departure at top, latest at bottom ── */
    const timelineRoutes = useMemo(() => {
        return [...saidasFilial].sort((a, b) => {
            const aMin = getRouteRefMinutes(a) ?? -1; // no time → sort to top
            const bMin = getRouteRefMinutes(b) ?? -1;
            return aMin - bMin; // earliest first (top), latest last (bottom)
        });
    }, [saidasFilial]);

    const pendentesVerificacao = useMemo(() => {
        return saidasFilial
            .filter(s => {
                const st = (s.statusOp || '').toUpperCase();
                const isAtrasada = st.includes('ATRAS');
                const isAdiantada = st.includes('ADIANT');
                if (!isAtrasada && !isAdiantada) return false;

                const missingMotivo = !s.motivoAtraso || s.motivoAtraso.trim() === '';
                const missingObs = !s.observacao || s.observacao.trim() === '';
                const noInicio = !s.horarioInicio || s.horarioInicio.trim() === '';

                return missingMotivo || missingObs || noInicio;
            })
            .map(s => {
                const missingMotivo = !s.motivoAtraso || s.motivoAtraso.trim() === '';
                const missingObs = !s.observacao || s.observacao.trim() === '';
                const noInicio = !s.horarioInicio || s.horarioInicio.trim() === '';

                let severity: 'red' | 'yellow';
                if (missingMotivo || missingObs) {
                    severity = 'red';
                } else {
                    severity = 'yellow';
                }

                return {
                    id: s.id,
                    title: s.title,
                    statusOp: s.statusOp || '--',
                    horarioSaida: s.horarioSaida,
                    motivoAtraso: s.motivoAtraso,
                    observacao: s.observacao,
                    horarioInicio: s.horarioInicio,
                    severity,
                };
            });
    }, [saidasFilial]);

    const isD1 = useMemo(() => {
        return false;
    }, []);

    const maintFiltered = useMemo(() => {
        const placaToRotas = new Map<string, string[]>();
        for (const s of saidasFilial) {
            const placa = s.placa?.toUpperCase();
            if (!placa) continue;
            const rotas = placaToRotas.get(placa) || [];
            const title = s.title || '--';
            if (!rotas.includes(title)) rotas.push(title);
            placaToRotas.set(placa, rotas);
        }
        if (placaToRotas.size === 0) return [];
        return maintenances
            .filter(m => placaToRotas.has(m.placa.toUpperCase()))
            .map(m => ({
                ...m,
                rotas: placaToRotas.get(m.placa.toUpperCase())?.join(', ') || '--',
            }));
    }, [maintenances, saidasFilial]);

    const qntRotasTotal = useMemo(() => saidasFilial.length, [saidasFilial]);

    const clockDisplay = useMemo(() => new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }), [nowHour]);

    /* ── Ticker data ── */
    const tickerItems = useMemo(() => {
        const nowMin = new Date().getHours() * 60 + new Date().getMinutes();

        const relevant = saidasFilial.filter(s => {
            const st = (s.statusOp || '').toUpperCase();
            if (st.includes('ATRAS') || st.includes('ADIANT')) return true;
            if (st.includes('PENDENT') || st.includes('VERIF')) return true;
            // has meaningful observation
            if (s.observacao && s.observacao.trim() !== '' && s.observacao.trim().toUpperCase() !== 'N/A') return true;
            return false;
        });

        return relevant
            .map(s => {
                const st = (s.statusOp || '').toUpperCase();
                const isAtrasada = st.includes('ATRAS');
                const isAdiantada = st.includes('ADIANT');
                const saidaMin = parseClockToMinutes(s.horarioSaida);
                const inicioMin = parseClockToMinutes(s.horarioInicio);

                let deltaMin = 0;
                if (isAtrasada && saidaMin !== null && inicioMin !== null) {
                    deltaMin = inicioMin - saidaMin; // positive = late
                } else if (isAdiantada && saidaMin !== null && inicioMin !== null) {
                    deltaMin = inicioMin - saidaMin; // negative = early
                } else if (isAtrasada && saidaMin !== null) {
                    deltaMin = nowMin - saidaMin;
                } else if (isAdiantada && saidaMin !== null) {
                    deltaMin = saidaMin - nowMin;
                }

                const sign = deltaMin >= 0 ? '▼' : '▲';
                const absMin = Math.abs(deltaMin);
                const h = Math.floor(absMin / 60);
                const m = absMin % 60;
                const deltaStr = `${sign} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

                const obs = s.observacao?.trim() || s.motivoAtraso?.trim() || 'Sem detalhes';
                const operacao = s.operacao?.trim();

                let text = `ROTA ${s.title}: ${deltaStr} | ${obs}`;
                if (filterMode === 'celula' && operacao) {
                    text += ` — ${operacao}`;
                }

                return { text, isAtrasada, isAdiantada, deltaMin, id: s.id };
            })
            .sort((a, b) => {
                // biggest delays first, then recent, then pending
                if (a.isAtrasada && !b.isAtrasada) return -1;
                if (!a.isAtrasada && b.isAtrasada) return 1;
                return b.deltaMin - a.deltaMin;
            });
    }, [saidasFilial, filterMode, nowHour]);

    /* ── auto-scroll ── */
    /* ── Timeline auto-scroll: keeps focus on routes near current time ── */
    useEffect(() => {
        if (!timelineRowsRef.current || timelineRoutes.length === 0) return;
        const el = timelineRowsRef.current;
        const nowMin = Math.floor(nowHour * 60);

        const t = setTimeout(() => {
            const rows = el.querySelectorAll('.timeline-row');

            // Find focus index based on REAL route times (not visual position).
            // Strategy: find the last route with refTime <= nowMin,
            // then scroll so that route (and a couple upcoming) are visible.
            let focusIdx = -1;
            for (let idx = 0; idx < timelineRoutes.length; idx++) {
                const route = timelineRoutes[idx];
                const refMin = getRouteRefMinutes(route);
                if (refMin === null) continue; // skip routes with no time reference
                if (refMin <= nowMin) {
                    focusIdx = idx;
                }
            }

            // If no past route found, use the first route with a future time
            if (focusIdx === -1) {
                for (let idx = 0; idx < timelineRoutes.length; idx++) {
                    const refMin = getRouteRefMinutes(timelineRoutes[idx]);
                    if (refMin !== null) { focusIdx = idx; break; }
                }
            }

            // If still nothing (all routes have null time), show from the top
            if (focusIdx === -1) focusIdx = 0;

            if (focusIdx >= 0 && rows[focusIdx]) {
                const refRow = rows[focusIdx] as HTMLElement;
                const top = Math.max(0, refRow.offsetTop - el.offsetTop - 10);
                el.scrollTo({ top, behavior: 'smooth' });
            }
        }, 300);

        return () => clearTimeout(t);
    }, [nowHour, timelineRoutes, activeFilialIndex, activeCelulaIndex]);

    useEffect(() => {
        const scroll = (el: HTMLDivElement | null): ReturnType<typeof setTimeout> | null => {
            if (!el || el.scrollHeight <= el.clientHeight) return null;
            const dist = el.scrollHeight - el.clientHeight;
            const dur = Math.max(dist * 18, 3000);
            const t0 = Date.now();
            const s0 = el.scrollTop;
            let frame: number;
            const step = () => {
                const p = Math.min((Date.now() - t0) / dur, 1);
                const ease = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
                el.scrollTop = s0 + (dist - s0) * ease;
                if (p < 1) frame = requestAnimationFrame(step);
                else setTimeout(() => el.scrollTo({ top: 0, behavior: 'smooth' }), 2000);
            };
            return setTimeout(() => { frame = requestAnimationFrame(step); }, 3000);
        };
        const timers = [scroll(tableWrapRef.current)];
        return () => timers.forEach(t => { if (t) clearTimeout(t); });
    }, [saidasFilial, activeFilialIndex, activeCelulaIndex, filterMode]);

    /* ── pill timer ── */
    const pillProgress = shouldRotate ? ((ROTATE_INTERVAL_MS / 1000 - timeLeft) / (ROTATE_INTERVAL_MS / 1000)) * 100 : 0;
    const nextLabel = filterMode === 'celula' ? 'Próx. célula' : 'Próx. filial';
    const nowPosition = toPercent(nowHour);

    /* ── KPI bar widths (clamped 0-100) ── */
    const kpiTarget = (kpi: KPIData): number | null => {
        if (kpi.id === 'sla-saidas') return 95;
        if (kpi.id === 'sla-ncol') return 99.80;
        return null;
    };

    const kpiBarWidth = (kpi: KPIData) => {
        if (kpi.kind === 'number') return Math.min(kpi.value * 10, 100);
        return Math.min(Math.max(kpi.value, 0), 100);
    };

    /* ── Timeline bar positioning ── */
    const BAR_WIDTH_HOURS = 10; // each bar spans 10 hours on the 0-24 axis

    /* ================================================================
       RENDER
       ================================================================ */
    return (
        <div className="dash-shell">
            {/* ── TOP BAR: Logo/Title (left) + Cards (right) ── */}
            <header className="dash-top-bar">
                <div className="dash-top-left">
                    <div className="dash-header-logo">
                        <img src={logoImg} alt="Logo" className="dash-logo-img" />
                    </div>
                    <span className="dash-header-title">
                        {filterMode === 'celula'
                            ? (activeCelula ? activeCelula.label : '...')
                            : (activeFilial ? activeFilial.nomeExibicao.toUpperCase() : '...')
                        }
                    </span>
                </div>
                <div className="dash-top-right">
                    {indicadores.map(kpi => {
                        const target = kpiTarget(kpi);
                        const metTarget = target !== null && kpi.value >= target;
                        const barCls = metTarget ? 'bar-green' : 'bar-red';
                        const cardCls = metTarget ? 'kpi-good' : 'kpi-bad';
                        return (
                            <div key={kpi.id} className={`dash-kpi-card ${cardCls}`}>
                                <div className="dash-kpi-top">
                                    <div>
                                        <span className="dash-kpi-value">
                                            <AnimatedNumber value={kpi.value} decimals={kpi.kind === 'gauge' ? 2 : 0} />
                                            {kpi.kind === 'gauge' && <span className="dash-kpi-pct">%</span>}
                                        </span>
                                    </div>
                                    {target !== null && (
                                        <span className="dash-kpi-meta" style={{ color: metTarget ? 'var(--green)' : 'var(--red)' }}>
                                            Meta {target % 1 === 0 ? target : target.toFixed(2)}%
                                        </span>
                                    )}
                                </div>
                                <span className="dash-kpi-label">{kpi.label}</span>
                                <div className="dash-kpi-bar">
                                    <div
                                        className={`dash-kpi-bar-fill ${barCls}`}
                                        style={{ width: `${kpiBarWidth(kpi)}%` }}
                                    />
                                    {target !== null && (
                                        <div
                                            className="dash-kpi-target-mark"
                                            style={{ left: `${Math.min(target, 100)}%` }}
                                        />
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {/* Rotas Pendentes (placeholder) */}
                    <div className={`dash-kpi-card ${rotasPendentesCount > 0 ? 'kpi-bad' : 'kpi-good'}`}>
                        <div className="dash-kpi-top">
                            <span className="dash-kpi-value">
                                <AnimatedNumber value={rotasPendentesCount} />
                            </span>
                        </div>
                        <span className="dash-kpi-label">Rotas Pendentes</span>
                        <div className="dash-kpi-bar">
                            <div
                                className={`dash-kpi-bar-fill ${rotasPendentesCount > 0 ? 'bar-red' : 'bar-green'}`}
                                style={{ width: `${Math.min(rotasPendentesCount * 10, 100)}%` }}
                            />
                        </div>
                    </div>
                </div>
            </header>

            {/* ── OPERATIONAL TICKER ── */}
            <div className="dash-ticker">
                <div className="dash-ticker-track">
                    <div className="dash-ticker-content">
                        {tickerItems.length > 0 ? (
                            <>
                                {tickerItems.map(item => (
                                    <span key={item.id} className={`dash-ticker-item ${item.isAtrasada ? 'ticker-late' : 'ticker-default'}`}>
                                        {item.text}
                                    </span>
                                ))}
                                {/* Duplicate for seamless loop */}
                                {tickerItems.map(item => (
                                    <span key={`dup-${item.id}`} className={`dash-ticker-item ${item.isAtrasada ? 'ticker-late' : 'ticker-default'}`}>
                                        {item.text}
                                    </span>
                                ))}
                            </>
                        ) : (
                            <>
                                <span className="dash-ticker-item ticker-ok">Nenhum atraso/adiantamento registrado até o momento</span>
                                <span className="dash-ticker-item ticker-ok">Nenhum atraso/adiantamento registrado até o momento</span>
                            </>
                        )}
                    </div>
                </div>
            </div>

            {/* ── MAIN 3-COLUMN AREA ── */}
            <main className="dash-main">
                {/* LEFT — Timeline Chart (full height) */}
                <section className="dash-panel">
                    <div className="dash-panel-head">
                        <span className="dash-panel-title">Atrasos no Dia</span>
                        <span className="dash-panel-subtitle">
                            <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center', fontSize: 10 }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--route-gray)', display: 'inline-block' }}></span>
                                    Prevista
                                </span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--route-blue)', display: 'inline-block' }}></span>
                                    OK
                                </span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--route-yellow)', display: 'inline-block' }}></span>
                                    Pend. Verif.
                                </span>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                    <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--route-red)', display: 'inline-block' }}></span>
                                    Atrasada/Adiant.
                                </span>
                            </span>
                        </span>
                    </div>
                    <div className="dash-timeline-body">
                        <div className="timeline-grid">
                            {/* Vertical guide lines at 0, 6, 12, 18, 24 */}
                            {timelineMarks.map(h => (
                                <div
                                    key={h}
                                    className="timeline-guide"
                                    style={{ left: `${toPercent(h)}%` }}
                                />
                            ))}

                            {/* Current time indicator */}
                            {nowHour >= 0 && nowHour <= 24 && (
                                <div className="timeline-now" style={{ left: `${nowPosition}%` }}>
                                    <span className="timeline-now-label">
                                        {String(Math.floor(nowHour)).padStart(2, '0')}:{String(Math.floor((nowHour % 1) * 60)).padStart(2, '0')}
                                    </span>
                                </div>
                            )}

                            {/* Route bars */}
                            <div className="timeline-rows" ref={timelineRowsRef}>
                                {timelineRoutes.length > 0 ? timelineRoutes.map(s => {
                                    const refMin = getRouteRefMinutes(s);
                                    const refHour = refMin !== null ? refMin / 60 : null;
                                    // Position based on real time; no time → left edge (0h)
                                    const leftPct = refHour !== null ? toPercent(refHour) : 0;
                                    const rawWidth = toPercent(BAR_WIDTH_HOURS);
                                    const widthPct = Math.min(rawWidth, 100 - leftPct);
                                    const color = getRouteBarColor(s);
                                    const hasNoRefTime = refMin === null;
                                    const barText = hasNoRefTime
                                        ? `${s.title} — S/ horário`
                                        : color === 'red' && s.motivoAtraso
                                        ? `${s.title} — ${s.motivoAtraso}`
                                        : s.title;
                                    return (
                                        <div key={s.id} className="timeline-row">
                                            <div
                                                className={`timeline-bar timeline-bar-${color}`}
                                                style={{
                                                    left: `${leftPct}%`,
                                                    width: `${widthPct}%`,
                                                    fontSize: widthPct < 8 ? '8px' : widthPct < 20 ? '10px' : widthPct < 35 ? '11px' : '12px',
                                                    padding: `0 ${widthPct < 8 ? 4 : widthPct < 20 ? 6 : 10}px`,
                                                    justifyContent: widthPct < 15 ? 'center' : undefined,
                                                }}
                                                title={`${s.title} | ${s.horarioSaida || '--'} | ${s.statusOp || '--'}${s.motivoAtraso ? ' | ' + s.motivoAtraso : ''}`}
                                            >
                                                {widthPct < 5 ? s.title.substring(0, 5) + '…' : barText}
                                            </div>
                                        </div>
                                    );
                                }) : (
                                    <div className="timeline-empty">
                                        {loading ? 'Carregando...' : 'Nenhuma rota registrada'}
                                    </div>
                                )}
                            </div>

                            {/* Time axis */}
                            <div className="timeline-axis">
                                {timelineMarks.map(h => (
                                    <span key={h} style={{ left: `${toPercent(h)}%` }}>
                                        {String(h).padStart(2, '0')}h
                                    </span>
                                ))}
                            </div>
                        </div>
                    </div>
                </section>

                {/* CENTER — Tables stacked */}
                <div className="dash-center-stack">
                    <section className="dash-panel">
                        <div className="dash-panel-head">
                            <span className="dash-panel-title">Saídas de Rotas do Dia</span>
                        </div>
                        {filterMode === 'celula' && proximaRota && (
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 12,
                                padding: '8px 14px', margin: '0 0 4px',
                                background: 'rgba(59,130,246,0.12)',
                                borderRadius: 6, borderLeft: '3px solid var(--blue)',
                            }}>
                                <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Próx. rota</span>
                                <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 14 }}>{proximaRota.title}</span>
                                <span style={{
                                    fontWeight: 700, fontSize: 13, color: 'var(--blue)',
                                }}>
                                    Prevista em {proximaRota.label}
                                </span>
                            </div>
                        )}
                        <div className="dash-center-stats">
                            <span className="dash-stat-value"><AnimatedNumber value={qntRotasTotal} /></span>
                            <div>
                                <div className="dash-stat-label">Saídas Registradas</div>
                                {filterMode === 'celula' && (
                                    <div className="dash-stat-sub">
                                        {saidasCelula.filter(s => !(s.statusOp || '').toUpperCase().match(/ATRAS|ADIANT|NO PRAZO/)).length} previstas · {saidasCelula.filter(s => (s.statusOp || '').toUpperCase().includes('ATRAS')).length} atrasadas
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="dash-table-wrap" ref={tableWrapRef}>
                            <table className="dash-table">
                            <thead>
                                <tr>
                                    <th>Rota</th>
                                    <th>Placa</th>
                                    <th>Status</th>
                                    <th>Hr. Saída</th>
                                    <th>Hr. Início</th>
                                    <th>Motivo Atraso</th>
                                    <th>Observação</th>
                                </tr>
                            </thead>
                            <tbody>
                                {saidasCelula.length > 0 ? saidasCelula.map(s => {
                                    const stUpper = (s.statusOp || '').toUpperCase();
                                    const isAtrasada = stUpper.includes('ATRAS');
                                    const isAdiantada = stUpper.includes('ADIANT');
                                    const isPrevista = !isAtrasada && !isAdiantada && !stUpper.includes('NO PRAZO');
                                    const sc = isAtrasada ? 'status-atrasado' : isAdiantada ? 'status-atrasado' : isPrevista ? 'status-andamento' : 'status-ok';
                                    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
                                    const saidaMin = parseClockToMinutes(s.horarioSaida);
                                    const atrasoMin = isAtrasada && saidaMin !== null ? nowMin - saidaMin : null;
                                    return (
                                        <tr key={s.id} style={isPrevista && filterMode === 'celula' ? { background: 'rgba(59,130,246,0.06)' } : undefined}>
                                            <td>{s.title}</td>
                                            <td>{s.placa || '--'}</td>
                                            <td className={`col-status ${sc}`}>
                                                {s.statusOp || '--'}
                                                {isPrevista && !s.horarioInicio && filterMode === 'celula' && saidaMin !== null && (
                                                    <span style={{ fontSize: 10, color: 'var(--blue)', marginLeft: 6 }}>
                                                        {saidaMin > nowMin ? `em ${formatTimeDelta(saidaMin - nowMin)}` : `venceu ${formatTimeDelta(nowMin - saidaMin)} atrás`}
                                                    </span>
                                                )}
                                                {isAtrasada && !s.horarioInicio && atrasoMin !== null && filterMode === 'celula' && (
                                                    <span style={{ fontSize: 10, color: 'var(--red)', marginLeft: 6 }}>
                                                        {formatTimeDelta(atrasoMin)} sem sair
                                                    </span>
                                                )}
                                            </td>
                                            <td>{s.horarioSaida || '--'}</td>
                                            <td>{s.horarioInicio ? s.horarioInicio : <span style={{ color: isAtrasada ? 'var(--red)' : 'var(--text-muted)' }}>Pendente</span>}</td>
                                            <td>{s.motivoAtraso || '--'}</td>
                                            <td className="col-obs">{s.observacao || '--'}</td>
                                        </tr>
                                    );
                                }) : (
                                    <tr>
                                        <td colSpan={7} style={{ textAlign: 'center', padding: 24, color: 'var(--text-muted)' }}>
                                            {loading ? 'Carregando...' : 'Nenhuma saída registrada'}
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </section>

                    {/* Pendentes de Verificação */}
                    <section className="dash-panel">
                        <div className="dash-panel-head">
                            <span className="dash-panel-title">Rotas Pendentes de Verificação</span>
                            <span className="dash-panel-subtitle">
                                {pendentesVerificacao.length} pendente{pendentesVerificacao.length !== 1 ? 's' : ''}
                            </span>
                        </div>
                        <div className="dash-table-wrap">
                            <table className="dash-table">
                                <thead>
                                    <tr>
                                        <th>Rota</th>
                                        <th>Status</th>
                                        <th>Hr. Saída</th>
                                        <th>Hr. Início</th>
                                        <th>Motivo</th>
                                        <th>Observação</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pendentesVerificacao.length > 0 ? pendentesVerificacao.map(p => (
                                        <tr key={p.id} className={`row-${p.severity}`}>
                                            <td>{p.title}</td>
                                            <td className={`col-status ${p.severity === 'red' ? 'status-atrasado' : 'status-andamento'}`}>{p.statusOp}</td>
                                            <td>{p.horarioSaida || '--'}</td>
                                            <td>{p.horarioInicio || '--'}</td>
                                            <td>{p.motivoAtraso || <span style={{ color: 'var(--red)' }}>Pendente</span>}</td>
                                            <td>{p.observacao || <span style={{ color: 'var(--red)' }}>Pendente</span>}</td>
                                        </tr>
                                    )) : (
                                        <tr>
                                            <td colSpan={6} style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>
                                                Nenhuma rota pendente de verificação
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </section>
                </div>

                {/* RIGHT — 48H sem coleta */}
                <section className="dash-panel">
                    <div className="dash-panel-head">
                        <span className="dash-panel-title">48H sem Coleta</span>
                        <span className="dash-panel-subtitle">
                            Produtores com maior tempo sem coleta
                        </span>
                    </div>
                    <div className="dash-chart-area" ref={chartAreaRef}>
                        {produtoresChart.length > 0 ? (() => {
                            const maxDias = Math.max(...produtoresChart.map(p => p.dias_sem_coleta));
                            return produtoresChart.map((item, idx) => (
                                <div key={item.codigo} className="dash-bar-row">
                                    <span className="dash-bar-label" title={`${item.produtor} — ${item.operacao}`}>{item.produtor} <span style={{ color: 'var(--text-muted)', fontSize: '0.8em' }}>- {item.operacao}</span></span>
                                    <span className="dash-bar-count">{item.dias_sem_coleta} dias</span>
                                </div>
                            ));
                        })() : (
                            <div className="dash-cards-empty">
                                {loading ? 'Carregando...' : 'Todos os produtores coletados nas últimas 48h'}
                            </div>
                        )}
                    </div>
                </section>
            </main>

            {/* ── FOOTER — Última atualização ── */}
            <footer className="dash-update-footer">
                <span className="dash-update-label">Última atualização</span>
                <span className="dash-update-label" style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                    {lastUpdate
                        ? lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
                        : '--:--:--'
                    }
                </span>
            </footer>

            {/* ── PILL TIMER ── */}
            {shouldRotate && (
                <div className="dash-pill">
                    <span className="dash-pill-label">{nextLabel}</span>
                    <div className="dash-pill-track">
                        <div className="dash-pill-fill" style={{ width: `${pillProgress}%` }} />
                    </div>
                    <span className="dash-pill-count">{timeLeft}s</span>
                </div>
            )}
        </div>
    );
}
