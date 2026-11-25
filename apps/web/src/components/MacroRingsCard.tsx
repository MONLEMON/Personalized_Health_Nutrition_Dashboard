import type { EnergySummary, MacroBreakdown } from '@health-dash/shared';
import { Flame, PieChart } from 'lucide-react';
import { BentoCard } from './BentoCard';

export interface MacroRingsCardProps {
  energy: EnergySummary;
  macros: MacroBreakdown;
}

interface RadialRingProps {
  size: number;
  strokeWidth: number;
  percentage: number;
  color: string;
  trackColor?: string;
}

function RadialRing({
  size,
  strokeWidth,
  percentage,
  color,
  trackColor = 'rgba(255,255,255,0.07)',
}: RadialRingProps) {
  const center = size / 2;
  const radius = center - strokeWidth / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percentage));
  const dashOffset = circumference * (1 - clamped / 100);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={trackColor}
        strokeWidth={strokeWidth}
      />
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={dashOffset}
        className="transition-[stroke-dashoffset] duration-700 ease-out"
      />
    </svg>
  );
}

interface MacroItemConfig {
  key: 'protein' | 'carbs' | 'fat';
  label: string;
  color: string;
  badgeBg: string;
}

const MACRO_CONFIGS: MacroItemConfig[] = [
  {
    key: 'protein',
    label: 'Protein',
    color: '#2EE6A6',
    badgeBg: 'bg-[#2EE6A6]/10 text-[#2EE6A6]',
  },
  {
    key: 'carbs',
    label: 'Carbs',
    color: '#38BDF8',
    badgeBg: 'bg-[#38BDF8]/10 text-[#38BDF8]',
  },
  {
    key: 'fat',
    label: 'Fat',
    color: '#FBBF24',
    badgeBg: 'bg-[#FBBF24]/10 text-[#FBBF24]',
  },
];

export function MacroRingsCard({ energy, macros }: MacroRingsCardProps) {
  const isOverCalories = energy.remainingCalories < 0;
  const calorieRingColor = isOverCalories ? '#FF5C6C' : '#2EE6A6';
  const multiplierApprox =
    energy.bmr > 0 ? (energy.baselineTdee / energy.bmr).toFixed(2) : '1.35';

  return (
    <BentoCard
      title="Energy & Macro Rings"
      subtitle="Real-time target synced to Dynamic TDEE"
      icon={<PieChart className="h-4 w-4 text-[#2EE6A6]" />}
      headerRight={
        <span className="tabular-nums inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-medium text-slate-300">
          <Flame className="h-3.5 w-3.5 text-[#FFB020]" />
          {energy.intakePercentage}% intake
        </span>
      }
      accentGlow="sky"
      className="h-full"
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        {/* Hero Calories Remaining Ring */}
        <div className="flex flex-col items-center justify-center rounded-2xl border border-white/5 bg-[#0F131C]/80 p-5 sm:w-[240px] sm:shrink-0">
          <div className="relative flex items-center justify-center">
            <RadialRing
              size={156}
              strokeWidth={12}
              percentage={energy.intakePercentage}
              color={calorieRingColor}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
                {isOverCalories ? 'Over Target' : 'Remaining'}
              </span>
              <span
                className={`tabular-nums mt-0.5 text-3xl font-bold tracking-tight ${
                  isOverCalories ? 'text-[#FF5C6C]' : 'text-white'
                }`}
              >
                {Math.abs(energy.remainingCalories).toLocaleString()}
              </span>
              <span className="text-[11px] text-slate-400">kcal</span>
            </div>
          </div>

          <div className="mt-4 w-full space-y-1.5 border-t border-white/5 pt-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Consumed / Target</span>
              <span className="tabular-nums font-semibold text-white">
                {energy.consumedCalories.toLocaleString()} / {energy.targetCalories.toLocaleString()}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-400">
              <span>Dynamic TDEE</span>
              <span className="tabular-nums text-slate-300">
                {energy.bmr} × {multiplierApprox} + {energy.activeCalories} ={' '}
                <strong className="text-white">{energy.dynamicTdee}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* 3 Macro Radial Rings */}
        <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
          {MACRO_CONFIGS.map((cfg) => {
            const item = macros[cfg.key];
            const overGrams = item.remaining < 0;

            return (
              <div
                key={cfg.key}
                className="flex flex-row items-center justify-between gap-3 rounded-2xl border border-white/5 bg-[#0F131C]/75 p-4 sm:flex-col sm:justify-center sm:text-center lg:flex-row lg:justify-between lg:text-left xl:flex-col xl:justify-center xl:text-center"
              >
                <div className="relative flex shrink-0 items-center justify-center">
                  <RadialRing
                    size={88}
                    strokeWidth={8}
                    percentage={item.percentage}
                    color={cfg.color}
                  />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="tabular-nums text-base font-bold text-white">
                      {item.percentage}%
                    </span>
                  </div>
                </div>

                <div className="min-w-0 space-y-1">
                  <div className="flex items-center justify-end gap-1.5 sm:justify-center lg:justify-start xl:justify-center">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${cfg.badgeBg}`}
                    >
                      {cfg.label}
                    </span>
                  </div>
                  <div className="tabular-nums text-sm font-semibold text-white">
                    {Math.round(item.consumed)}g{' '}
                    <span className="font-normal text-slate-500">/ {Math.round(item.target)}g</span>
                  </div>
                  <div
                    className={`tabular-nums text-xs ${
                      overGrams ? 'text-[#FF5C6C]' : 'text-slate-400'
                    }`}
                  >
                    {overGrams
                      ? `${Math.abs(Math.round(item.remaining))}g over`
                      : `${Math.round(item.remaining)}g left`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </BentoCard>
  );
}
