import { CSSProperties } from 'react';
import { KPIData } from '../types';

interface IndicadorKPIProps {
  data: KPIData;
}

export function IndicadorKPI({ data }: IndicadorKPIProps): JSX.Element {
  const gaugeStyle =
    data.accent === 'blue-red'
      ? ({
          '--value': `${data.value}%`,
          '--gauge-color': '#1d8cf5',
          '--rest-color': '#b70505'
        } as CSSProperties)
      : ({
          '--value': `${data.value}%`,
          '--gauge-color': '#1d8cf5',
          '--rest-color': '#1b2f99'
        } as CSSProperties);

  return (
    <div className="kpi-card-mock">
      {data.kind === 'gauge' ? (
        <div className="kpi-gauge" style={gaugeStyle}>
          <span>{Math.round(data.value)}%</span>
        </div>
      ) : (
        <div className="kpi-number">{Math.round(data.value)}</div>
      )}
      <span className="kpi-caption">{data.label}</span>
    </div>
  );
}

interface KPIsContainerProps {
  indicadores: KPIData[];
}

export function KPIsContainer({ indicadores }: KPIsContainerProps): JSX.Element {
  return (
    <section className="kpi-container">
      {indicadores.map(kpi => (
        <IndicadorKPI key={kpi.id} data={kpi} />
      ))}
    </section>
  );
}
