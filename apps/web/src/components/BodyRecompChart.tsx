import { useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import type { BodyTrendPoint, MetricsTrendsResponse } from '@health-dash/shared';
import { Activity, Scale } from 'lucide-react';

export type TrendTimeframeDays = 30 | 60 | 90;

export interface BodyRecompChartProps {
  trends: MetricsTrendsResponse | null;
  days: TrendTimeframeDays;
  onDaysChange: (days: TrendTimeframeDays) => void;
  loading?: boolean;
  onLogMetricClick?: () => void;
}

type SeriesKey = 'weightKg' | 'weightMa7' | 'skeletalMuscleMassKg' | 'bodyFatPct';

interface SeriesConfig {
  key: SeriesKey;
  label: string;
  unit: string;
  color: string;
  axis: 'left' | 'right';
}

const SERIES_CONFIG: readonly SeriesConfig[] = [
  { key: 'weightMa7', label: '7D Avg', unit: 'kg', color: '#38BDF8', axis: 'left' },
  { key: 'weightKg', label: 'Daily Weight', unit: 'kg', color: '#94A3B8', axis: 'left' },
  { key: 'skeletalMuscleMassKg', label: 'Muscle Mass', unit: 'kg', color: '#2EE6A6', axis: 'left' },
  { key: 'bodyFatPct', label: 'Body Fat %', unit: '%', color: '#FFB020', axis: 'right' },
];

const TIMEFRAME_OPTIONS: readonly TrendTimeframeDays[] = [30, 60, 90];

function formatShortDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatDelta(
  value: number | null,
  unit: string,
  favorableDirection: 'down' | 'up',
): { text: string; toneClass: string } {
  if (value === null || Number.isNaN(value)) {
    return { text: '—', toneClass: 'text-slate-400' };
  }
  const sign = value > 0 ? '+' : '';
  const text = `${sign}${value.toFixed(1)} ${unit}`;
  if (Math.abs(value) < 0.05) {
    return { text: `0.0 ${unit}`, toneClass: 'text-slate-300' };
  }
  const isFavorable = favorableDirection === 'down' ? value < 0 : value > 0;
  return {
    text,
    toneClass: isFavorable ? 'text-[#2EE6A6]' : 'text-[#FFB020]',
  };
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 639px)');
    const update = () => setIsMobile(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return isMobile;
}

function CustomTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) {
    return null;
  }

  const point = payload[0]?.payload as BodyTrendPoint | undefined;
  const formattedDate = typeof label === 'string' ? formatShortDate(label) : String(label ?? '');

  return (
    <div className="max-w-[200px] rounded-2xl border border-white/10 bg-[#0F131C]/95 px-3 py-2.5 shadow-2xl backdrop-blur-xl sm:min-w-[190px] sm:max-w-none sm:px-3.5 sm:py-3">
      <div className="mb-2 flex items-center justify-between border-b border-white/10 pb-1.5">
        <span className="text-xs font-semibold tracking-wide text-slate-200">{formattedDate}</span>
        {point?.date ? (
          <span className="font-mono text-[10px] text-slate-500">{point.date}</span>
        ) : null}
      </div>
      <div className="space-y-1.5">
        {payload.map((entry) => {
          const key = String(entry.dataKey ?? '') as SeriesKey;
          const config = SERIES_CONFIG.find((item) => item.key === key);
          const numericValue =
            typeof entry.value === 'number'
              ? entry.value
              : typeof entry.value === 'string'
                ? Number(entry.value)
                : null;
          if (numericValue === null || Number.isNaN(numericValue)) return null;

          return (
            <div key={key} className="flex items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-2 text-slate-300">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: config?.color ?? entry.color ?? '#94A3B8' }}
                />
                <span>{config?.label ?? entry.name ?? key}</span>
              </div>
              <span className="tabular-nums font-semibold text-white">
                {numericValue.toFixed(1)} {config?.unit ?? ''}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function BodyRecompChart({
  trends,
  days,
  onDaysChange,
  loading = false,
  onLogMetricClick,
}: BodyRecompChartProps) {
  const isMobile = useIsMobile();
  const [visibleSeries, setVisibleSeries] = useState<Record<SeriesKey, boolean>>({
    weightKg: true,
    weightMa7: true,
    skeletalMuscleMassKg: true,
    bodyFatPct: true,
  });

  const points = trends?.points ?? [];
  const summary = trends?.summary;

  const hasLeftSeries =
    visibleSeries.weightKg || visibleSeries.weightMa7 || visibleSeries.skeletalMuscleMassKg;
  const hasRightSeries = visibleSeries.bodyFatPct;

  const weightDelta = useMemo(
    () => formatDelta(summary?.weightDeltaKg ?? null, 'kg', 'down'),
    [summary?.weightDeltaKg],
  );
  const bodyFatDelta = useMemo(
    () => formatDelta(summary?.bodyFatDeltaPct ?? null, '%', 'down'),
    [summary?.bodyFatDeltaPct],
  );
  const muscleDelta = useMemo(
    () => formatDelta(summary?.muscleDeltaKg ?? null, 'kg', 'up'),
    [summary?.muscleDeltaKg],
  );

  const toggleSeries = (key: SeriesKey) => {
    setVisibleSeries((prev) => {
      const enabledCount = Object.values(prev).filter(Boolean).length;
      if (prev[key] && enabledCount <= 1) {
        return prev;
      }
      return { ...prev, [key]: !prev[key] };
    });
  };

  return (
    <section className="relative min-w-0 overflow-hidden rounded-3xl border border-white/5 bg-[#141720] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.45)] sm:p-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

      <div className="flex flex-col gap-3.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.16em] text-slate-400">
            <Scale className="h-3.5 w-3.5 text-[#38BDF8]" />
            <span>Body Recomposition</span>
          </div>
          <h2 className="mt-1 text-base font-semibold tracking-tight text-white sm:text-lg">
            Weight Trend, Lean Muscle &amp; Body Fat
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            7-day moving average smooths daily water fluctuations against lean mass retention.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onLogMetricClick ? (
            <button
              type="button"
              onClick={onLogMetricClick}
              className="inline-flex min-h-[44px] items-center rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2 text-xs font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/[0.08] sm:min-h-0 sm:px-3 sm:py-1.5"
            >
              + Weigh-In
            </button>
          ) : null}

          <div
            role="group"
            aria-label="Chart timeframe"
            className="inline-flex rounded-xl border border-white/10 bg-[#0A0C10]/80 p-1"
          >
            {TIMEFRAME_OPTIONS.map((option) => {
              const active = days === option;
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => onDaysChange(option)}
                  className={`min-h-[36px] rounded-lg px-3 py-1.5 text-xs font-semibold tabular-nums transition sm:min-h-0 sm:px-2.5 sm:py-1 ${
                    active
                      ? 'bg-white/12 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {option}D
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Delta Summary Chips */}
      <div className="mt-4 grid grid-cols-3 gap-2 sm:gap-2.5">
        <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0A0C10]/60 px-2.5 py-2 sm:px-3.5 sm:py-2.5">
          <div className="text-[11px] font-medium text-slate-400">Weight Δ</div>
          <div className={`mt-0.5 truncate text-sm font-semibold tabular-nums sm:text-base ${weightDelta.toneClass}`}>
            {weightDelta.text}
          </div>
          {summary ? (
            <div className="mt-0.5 truncate text-[10px] tabular-nums text-slate-500 sm:text-[11px]">
              {summary.startWeightKg.toFixed(1)} → {summary.currentWeightKg.toFixed(1)} kg
            </div>
          ) : null}
        </div>

        <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0A0C10]/60 px-2.5 py-2 sm:px-3.5 sm:py-2.5">
          <div className="text-[11px] font-medium text-slate-400">Body Fat Δ</div>
          <div className={`mt-0.5 truncate text-sm font-semibold tabular-nums sm:text-base ${bodyFatDelta.toneClass}`}>
            {bodyFatDelta.text}
          </div>
          {summary && summary.startBodyFatPct !== null && summary.currentBodyFatPct !== null ? (
            <div className="mt-0.5 truncate text-[10px] tabular-nums text-slate-500 sm:text-[11px]">
              {summary.startBodyFatPct.toFixed(1)}% → {summary.currentBodyFatPct.toFixed(1)}%
            </div>
          ) : null}
        </div>

        <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0A0C10]/60 px-2.5 py-2 sm:px-3.5 sm:py-2.5">
          <div className="text-[11px] font-medium text-slate-400">Muscle Δ</div>
          <div className={`mt-0.5 truncate text-sm font-semibold tabular-nums sm:text-base ${muscleDelta.toneClass}`}>
            {muscleDelta.text}
          </div>
          {summary && summary.startMuscleKg !== null && summary.currentMuscleKg !== null ? (
            <div className="mt-0.5 truncate text-[10px] tabular-nums text-slate-500 sm:text-[11px]">
              {summary.startMuscleKg.toFixed(1)} → {summary.currentMuscleKg.toFixed(1)} kg
            </div>
          ) : null}
        </div>
      </div>

      {/* Series Toggle Chips */}
      <div className="mt-3.5 flex flex-wrap items-center gap-1.5 sm:mt-4 sm:gap-2">
        {SERIES_CONFIG.map((series) => {
          const active = visibleSeries[series.key];
          return (
            <button
              key={series.key}
              type="button"
              onClick={() => toggleSeries(series.key)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-medium transition sm:gap-2 sm:px-3 sm:py-1 sm:text-xs ${
                active
                  ? 'border-white/15 bg-white/[0.07] text-slate-100'
                  : 'border-white/5 bg-transparent text-slate-500 hover:border-white/10 hover:text-slate-300'
              }`}
            >
              <span
                className="h-2 w-2 rounded-full transition-opacity"
                style={{
                  backgroundColor: series.color,
                  opacity: active ? 1 : 0.35,
                }}
              />
              <span>{series.label}</span>
            </button>
          );
        })}
      </div>

      {/* Recharts Canvas */}
      <div className="relative mt-4 h-[235px] w-full min-w-0 sm:h-[290px]">
        {loading && points.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-2xl border border-white/5 bg-[#0A0C10]/50">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Activity className="h-4 w-4 animate-pulse text-[#38BDF8]" />
              <span>Loading body composition trends…</span>
            </div>
          </div>
        ) : points.length === 0 ? (
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#0A0C10]/40 text-xs text-slate-400">
            No body composition weigh-ins recorded in this window yet.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart
              data={points}
              margin={
                isMobile
                  ? { top: 8, right: 2, left: -16, bottom: 0 }
                  : { top: 10, right: 8, left: -12, bottom: 0 }
              }
            >
              <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={formatShortDate}
                stroke="#64748B"
                tick={{ fill: '#94A3B8', fontSize: isMobile ? 10 : 11 }}
                tickLine={false}
                axisLine={false}
                minTickGap={isMobile ? 32 : 24}
              />
              {hasLeftSeries ? (
                <YAxis
                  yAxisId="left"
                  domain={['auto', 'auto']}
                  padding={{ top: 12, bottom: 12 }}
                  stroke="#64748B"
                  tick={{ fill: '#94A3B8', fontSize: isMobile ? 10 : 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={isMobile ? 38 : 48}
                  tickFormatter={(val: number) => `${val.toFixed(0)}kg`}
                />
              ) : null}
              {hasRightSeries ? (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={['auto', 'auto']}
                  padding={{ top: 12, bottom: 12 }}
                  stroke="#FFB020"
                  tick={{ fill: '#FFB020', fontSize: isMobile ? 10 : 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={isMobile ? 34 : 44}
                  tickFormatter={(val: number) => `${val.toFixed(0)}%`}
                />
              ) : null}
              <Tooltip
                content={<CustomTooltip />}
                cursor={{ stroke: 'rgba(255,255,255,0.12)', strokeWidth: 1 }}
              />
              {visibleSeries.weightKg ? (
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="weightKg"
                  name="Daily Weight"
                  stroke="rgba(148, 163, 184, 0.45)"
                  strokeWidth={1.25}
                  dot={{ r: 2.5, fill: '#94A3B8', strokeWidth: 0 }}
                  activeDot={{ r: 4, fill: '#E2E8F0', strokeWidth: 0 }}
                  isAnimationActive={false}
                />
              ) : null}
              {visibleSeries.weightMa7 ? (
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="weightMa7"
                  name="7D Avg"
                  stroke="#38BDF8"
                  strokeWidth={2.75}
                  dot={false}
                  activeDot={{ r: 5, fill: '#38BDF8', stroke: '#0A0C10', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ) : null}
              {visibleSeries.skeletalMuscleMassKg ? (
                <Line
                  yAxisId="left"
                  type="monotone"
                  dataKey="skeletalMuscleMassKg"
                  name="Muscle Mass"
                  stroke="#2EE6A6"
                  strokeWidth={2.25}
                  dot={false}
                  connectNulls
                  activeDot={{ r: 4.5, fill: '#2EE6A6', stroke: '#0A0C10', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ) : null}
              {visibleSeries.bodyFatPct ? (
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="bodyFatPct"
                  name="Body Fat %"
                  stroke="#FFB020"
                  strokeWidth={2.25}
                  strokeDasharray="5 4"
                  dot={false}
                  connectNulls
                  activeDot={{ r: 4.5, fill: '#FFB020', stroke: '#0A0C10', strokeWidth: 2 }}
                  isAnimationActive={false}
                />
              ) : null}
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}
