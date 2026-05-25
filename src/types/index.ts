export interface KPIData {
  id: string;
  label: string;
  value: number;
  kind: 'gauge' | 'number';
  accent?: 'blue' | 'blue-red';
}

export interface TimelineItem {
  id: string;
  startHour: number;
  endHour: number;
  tone: 'deep' | 'light';
  tooltip?: string;
}

export interface MaintenanceCard {
  id: string;
  oldestMaintenance: string;
  maintenanceCount: number;
}

export interface FilialConfig {
  id: string;
  operacao: string;
  nomeExibicao: string;
  plantId?: number;
  email?: string | null;
  tolerancia?: string | null;
  celulaIndex?: number;
}

export interface RotaSaida {
  id: string;
  title: string;
  operacao: string;
  horarioInicio: string | null;
  horarioSaida?: string | null;
  motorista?: string | null;
  placa?: string | null;
  statusGeral?: string | null;
  statusOp?: string | null;
  aviso?: string | null;
}

export type { RouteWebEvent, RouteWebRoute, PlantConfig as PlantConfigFromDB } from '../services/routeWebService';
