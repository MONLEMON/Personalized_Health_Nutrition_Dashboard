import type {
  BodyMetricDTO,
  EnergySummary,
  ReadinessStatus,
  ReadinessSummary,
  UserGoalDTO,
  WeeklyBudgetSummaryDTO,
} from '@health-dash/shared';
import { Activity, CalendarDays, Flame, Gauge, ShieldCheck, Sparkles, Zap } from 'lucide-react';
import { BentoCard } from './BentoCard';

export interface HeroStatusCardProps {
  readiness: ReadinessSummary;
  energy: EnergySummary;
  goal: UserGoalDTO;
  latestMetric: BodyMetricDTO;
  profileName?: string;
  weeklyBudget?: WeeklyBudgetSummaryDTO;
}

interface StatusTheme {
  accentHex: string;
  secondaryHex: string;
  glowBg: string;
  badgeClass: string;
  dotClass: string;
  accentGlow: 'mint' | 'amber' | 'coral';
  label: string;
}

const STATUS_THEMES: Record<ReadinessStatus, StatusTheme> = {
  optimal: {
    accentHex: '#2EE6A6',
    secondaryHex: '#0FA974',
    glowBg: 'rgba(46, 230, 166, 0.16)',
    badgeClass: 'border-[#2EE6A6]/30 bg-[#2EE6A6]/12 text-[#2EE6A6]',
    dotClass: 'bg-[#2EE6A6]',
    accentGlow: 'mint',
    label: 'Optimal',
  },
  moderate: {
    accentHex: '#FFB020',
    secondaryHex: '#D97706',
    glowBg: 'rgba(255, 176, 32, 0.16)',
    badgeClass: 'border-[#FFB020]/30 bg-[#FFB020]/12 text-[#FFB020]',
    dotClass: 'bg-[#FFB020]',
    accentGlow: 'amber',
    label: 'Moderate',
  },
  overload: {
    accentHex: '#FF5C6C',
    secondaryHex: '#E11D48',
    glowBg: 'rgba(255, 92, 108, 0.18)',
    badgeClass: 'border-[#FF5C6C]/30 bg-[#FF5C6C]/12 text-[#FF5C6C]',
    dotClass: 'bg-[#FF5C6C]',
    accentGlow: 'coral',
    label: 'Overload',
  },
};

const GOAL_BADGE_LABELS: Record<UserGoalDTO['goalType'], string> = {
  CUT: 'CUT',
  MAINTAIN: 'MAINTAIN',
  BULK: 'BULK',
};

const TRAINING_LOAD_LABELS: Record<ReadinessSummary['trainingLoadLevel'], string> = {
  rest: 'Rest Day',
  light: 'Light Load',
  moderate: 'Moderate Load',
  high: 'High Output',
};

function StatusOrb({ status, score }: { status: ReadinessStatus; score: number }) {
  const theme = STATUS_THEMES[status];
  const clampedScore = Math.max(0, Math.min(100, score));
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clampedScore / 100);

  return (
    <div className="relative flex h-32 w-32 shrink-0 items-center justify-center sm:h-44 sm:w-44">
      {/* Ambient radial aura */}
      <div
        aria-hidden="true"
        className="animate-pulse-aura absolute inset-2 rounded-full blur-2xl"
        style={{ background: theme.glowBg }}
      />

      <svg
        viewBox="0 0 160 160"
        className="relative h-full w-full overflow-visible"
        role="img"
        aria-label={`Readiness orb showing ${theme.label} state with score ${clampedScore}`}
      >
        <defs>
          <radialGradient id={`orb-grad-${status}`} cx="38%" cy="32%" r="68%">
            <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.45" />
            <stop offset="32%" stopColor={theme.accentHex} stopOpacity="0.95" />
            <stop offset="100%" stopColor={theme.secondaryHex} stopOpacity="0.88" />
          </radialGradient>
          <filter id={`orb-glow-${status}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Outer concentric aura rings */}
        <circle
          cx="80"
          cy="80"
          r="75"
          fill="none"
          stroke={theme.accentHex}
          strokeOpacity="0.14"
          strokeWidth="1"
        />
        <circle
          cx="80"
          cy="80"
          r="64"
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth="4"
        />

        {/* Readiness score progress ring */}
        <circle
          cx="80"
          cy="80"
          r={radius}
          fill="none"
          stroke={theme.accentHex}
          strokeWidth="4.5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 80 80)"
          className="transition-[stroke-dashoffset] duration-700 ease-out"
          filter={`url(#orb-glow-${status})`}
        />

        {/* Companion breathing orb */}
        <g className="animate-pulse-orb origin-center" style={{ transformOrigin: '80px 80px' }}>
          <circle
            cx="80"
            cy="80"
            r="46"
            fill={`url(#orb-grad-${status})`}
            stroke="rgba(255,255,255,0.28)"
            strokeWidth="1.25"
          />

          {/* Subtle top specular glass reflection */}
          <ellipse
            cx="68"
            cy="58"
            rx="18"
            ry="9"
            fill="white"
            fillOpacity="0.18"
            transform="rotate(-22 68 58)"
          />

          {/* Expressive StressWatch-style companion face */}
          <g className="animate-float-gentle" stroke="#081016" strokeLinecap="round" strokeLinejoin="round">
            {status === 'optimal' && (
              <>
                {/* Calm happy curved eyes */}
                <path d="M 60 76 Q 66 70 72 76" fill="none" strokeWidth="3.2" />
                <path d="M 88 76 Q 94 70 100 76" fill="none" strokeWidth="3.2" />
                {/* Soft smile */}
                <path d="M 70 89 Q 80 98 90 89" fill="none" strokeWidth="3.2" />
                {/* Subtle rosy cheeks */}
                <circle cx="59" cy="84" r="3.2" fill="#081016" fillOpacity="0.12" stroke="none" />
                <circle cx="101" cy="84" r="3.2" fill="#081016" fillOpacity="0.12" stroke="none" />
              </>
            )}

            {status === 'moderate' && (
              <>
                {/* Focused alert eyes */}
                <ellipse cx="66" cy="76" rx="3.4" ry="4.4" fill="#081016" stroke="none" />
                <ellipse cx="94" cy="76" rx="3.4" ry="4.4" fill="#081016" stroke="none" />
                <circle cx="67" cy="74.5" r="1.2" fill="#FFFFFF" stroke="none" />
                <circle cx="95" cy="74.5" r="1.2" fill="#FFFFFF" stroke="none" />
                {/* Steady focused mouth */}
                <path d="M 72 90 Q 80 92 88 90" fill="none" strokeWidth="3" />
              </>
            )}

            {status === 'overload' && (
              <>
                {/* Strained angled brows */}
                <path d="M 59 69 L 71 73" fill="none" strokeWidth="2.8" />
                <path d="M 101 69 L 89 73" fill="none" strokeWidth="2.8" />
                {/* Alert eyes */}
                <circle cx="66" cy="78" r="3.3" fill="#081016" stroke="none" />
                <circle cx="94" cy="78" r="3.3" fill="#081016" stroke="none" />
                {/* Strained wavy/downturned mouth */}
                <path d="M 70 93 Q 80 86 90 93" fill="none" strokeWidth="3.1" />
              </>
            )}
          </g>
        </g>
      </svg>
    </div>
  );
}

export function HeroStatusCard({
  readiness,
  energy,
  goal,
  latestMetric,
  profileName,
  weeklyBudget,
}: HeroStatusCardProps) {
  const theme = STATUS_THEMES[readiness.status];
  const formulaLabel =
    energy.bmrFormula === 'katch_mcardle' ? 'Katch-McArdle' : 'Mifflin-St Jeor';
  const adjustmentText =
    goal.calorieAdjustment > 0
      ? `+${goal.calorieAdjustment} kcal`
      : `${goal.calorieAdjustment} kcal`;
  const isOverTarget = energy.remainingCalories < 0;

  const cyclingPillClass =
    energy.cyclingDayType === 'high'
      ? 'border-[#2EE6A6]/35 bg-gradient-to-r from-[#2EE6A6]/15 to-[#38BDF8]/15 text-[#2EE6A6]'
      : energy.cyclingDayType === 'low'
        ? 'border-[#FFB020]/35 bg-[#FFB020]/12 text-[#FFB020]'
        : 'border-white/15 bg-white/[0.05] text-slate-200';

  const weeklyOver = weeklyBudget ? weeklyBudget.weeklyRemainingCalories < 0 : false;
  const weeklyProgressPct =
    weeklyBudget && weeklyBudget.weeklyTargetCalories > 0
      ? Math.round((weeklyBudget.weeklyConsumedCalories / weeklyBudget.weeklyTargetCalories) * 100)
      : 0;

  return (
    <BentoCard accentGlow={theme.accentGlow} className="w-full">
      <div className="flex min-w-0 flex-col gap-5 sm:gap-6 lg:flex-row lg:items-center lg:justify-between">
        {/* Left: Companion Orb + Core Readiness Copy */}
        <div className="flex min-w-0 flex-col items-center gap-5 sm:flex-row sm:items-center sm:gap-7">
          <StatusOrb status={readiness.status} score={readiness.score} />

          <div className="flex min-w-0 max-w-full flex-col items-center text-center sm:items-start sm:text-left">
            <div className="mb-2 flex max-w-full flex-wrap items-center justify-center gap-1.5 sm:justify-start sm:gap-2">
              <span
                className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold tracking-wide sm:px-3 ${theme.badgeClass}`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${theme.dotClass}`} />
                <span className="truncate">{readiness.badge}</span>
              </span>

              <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-slate-300">
                <Sparkles className="h-3 w-3 shrink-0 text-slate-400" />
                <span className="truncate">
                  {GOAL_BADGE_LABELS[goal.goalType]} ({adjustmentText})
                </span>
              </span>

              <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-slate-300">
                <ShieldCheck className="h-3 w-3 shrink-0 text-[#38BDF8]" />
                <span className="truncate">{formulaLabel}</span>
              </span>

              {energy.cyclingLabel ? (
                <span
                  className={`tabular-nums inline-flex max-w-full items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${cyclingPillClass}`}
                >
                  <Zap className="h-3 w-3 shrink-0" />
                  <span className="truncate">{energy.cyclingLabel}</span>
                </span>
              ) : null}
            </div>

            <div className="flex max-w-full flex-wrap items-baseline justify-center gap-x-3 gap-y-1 sm:justify-start">
              <span
                className="tabular-nums text-5xl font-bold tracking-tight text-white sm:text-6xl"
                style={{ textShadow: `0 0 28px ${theme.glowBg}` }}
              >
                {readiness.score}
              </span>
              <span className="text-sm font-medium text-slate-400">
                / 100 Readiness{profileName ? ` · ${profileName}` : ''}
              </span>
            </div>

            <h1 className="mt-2 max-w-full break-words text-lg font-semibold tracking-tight text-white sm:text-xl">
              {readiness.headline}
            </h1>
            <p className="mt-1 max-w-xl break-words text-sm leading-relaxed text-slate-400">
              {readiness.summary}
            </p>

            {/* Adherence & Body Snapshot */}
            <div className="mt-3 flex max-w-full flex-wrap items-center justify-center gap-x-3.5 gap-y-1 text-xs text-slate-400 sm:justify-start sm:gap-x-4">
              <span className="tabular-nums">
                Calorie Adherence:{' '}
                <strong className="font-semibold text-slate-200">
                  {readiness.calorieAdherencePct}%
                </strong>
              </span>
              <span className="tabular-nums">
                Protein Adherence:{' '}
                <strong className="font-semibold text-[#2EE6A6]">
                  {readiness.proteinAdherencePct}%
                </strong>
              </span>
              <span className="tabular-nums">
                Weight:{' '}
                <strong className="font-semibold text-slate-200">
                  {latestMetric.weightKg.toFixed(1)} kg
                </strong>
                {energy.leanBodyMassKg !== null && (
                  <span className="text-slate-500"> · LBM {energy.leanBodyMassKg.toFixed(1)} kg</span>
                )}
              </span>
              <span>
                Load:{' '}
                <strong className="font-semibold text-slate-200">
                  {TRAINING_LOAD_LABELS[readiness.trainingLoadLevel]}
                </strong>
              </span>
            </div>
          </div>
        </div>

        {/* Right: Compact Energy Metrics Strip */}
        <div className="grid min-w-0 grid-cols-3 gap-2 sm:gap-3 lg:w-[380px] lg:shrink-0">
          <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/90 p-2.5 sm:p-3.5">
            <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:gap-1.5 sm:text-[11px] sm:tracking-wider">
              <Gauge className="h-3.5 w-3.5 shrink-0 text-[#38BDF8]" />
              <span className="truncate">Dynamic TDEE</span>
            </div>
            <div className="tabular-nums mt-1.5 text-base font-bold text-white sm:mt-2 sm:text-2xl">
              {energy.dynamicTdee.toLocaleString()}
            </div>
            <div className="tabular-nums mt-0.5 truncate text-[10px] text-slate-500 sm:text-[11px]">
              Base {energy.baselineTdee.toLocaleString()} kcal
            </div>
          </div>

          <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/90 p-2.5 sm:p-3.5">
            <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:gap-1.5 sm:text-[11px] sm:tracking-wider">
              <Flame className="h-3.5 w-3.5 shrink-0 text-[#FFB020]" />
              <span className="truncate">Active Burn</span>
            </div>
            <div className="tabular-nums mt-1.5 text-base font-bold text-[#FFB020] sm:mt-2 sm:text-2xl">
              +{energy.activeCalories.toLocaleString()}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-slate-500 sm:text-[11px]">kcal today</div>
          </div>

          <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/90 p-2.5 sm:p-3.5">
            <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400 sm:gap-1.5 sm:text-[11px] sm:tracking-wider">
              <Zap
                className={`h-3.5 w-3.5 shrink-0 ${isOverTarget ? 'text-[#FF5C6C]' : 'text-[#2EE6A6]'}`}
              />
              <span className="truncate">{isOverTarget ? 'Over Target' : 'Remaining'}</span>
            </div>
            <div
              className={`tabular-nums mt-1.5 text-base font-bold sm:mt-2 sm:text-2xl ${
                isOverTarget ? 'text-[#FF5C6C]' : 'text-[#2EE6A6]'
              }`}
            >
              {Math.abs(energy.remainingCalories).toLocaleString()}
            </div>
            <div className="tabular-nums mt-0.5 truncate text-[10px] text-slate-500 sm:text-[11px]">
              Target {energy.targetCalories.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Compact Weekly Calorie Budget Panel */}
      {weeklyBudget ? (
        <div className="mt-5 min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/85 p-3.5 sm:p-4">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-semibold text-white">
                <CalendarDays className="h-3.5 w-3.5 shrink-0 text-[#38BDF8]" />
                <span>Weekly Budget</span>
                <span className="tabular-nums text-slate-300 font-medium">
                  ({weeklyBudget.weekStartDate} → {weeklyBudget.weekEndDate})
                </span>
              </span>
              {weeklyBudget.cyclingEnabled ? (
                <span className="rounded-full border border-[#38BDF8]/30 bg-[#38BDF8]/10 px-2 py-0.5 text-[10px] font-semibold text-[#38BDF8]">
                  Carb Cycling
                </span>
              ) : null}
            </div>

            <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2 text-xs">
              <span className="tabular-nums font-semibold text-slate-200">
                {weeklyBudget.weeklyConsumedCalories.toLocaleString()} /{' '}
                {weeklyBudget.weeklyTargetCalories.toLocaleString()} kcal
              </span>
              <span
                className={`tabular-nums max-w-full rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                  weeklyOver
                    ? 'border-[#FF5C6C]/35 bg-[#FF5C6C]/12 text-[#FF5C6C]'
                    : 'border-[#2EE6A6]/35 bg-[#2EE6A6]/12 text-[#2EE6A6]'
                }`}
              >
                {weeklyOver
                  ? `${Math.abs(weeklyBudget.weeklyRemainingCalories).toLocaleString()} kcal Over`
                  : `${weeklyBudget.weeklyRemainingCalories.toLocaleString()} kcal Remaining`}
              </span>
            </div>
          </div>

          <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                weeklyOver ? 'bg-[#FF5C6C]' : 'bg-gradient-to-r from-[#2EE6A6] to-[#38BDF8]'
              }`}
              style={{ width: `${Math.min(100, Math.max(0, weeklyProgressPct))}%` }}
            />
          </div>

          <div className="no-scrollbar mt-3 flex gap-2 overflow-x-auto px-0.5 pt-0.5 pb-1 snap-x snap-mandatory sm:grid sm:grid-cols-7 sm:gap-2 sm:overflow-visible sm:p-0">
            {weeklyBudget.days.map((day) => {
              const isDayOver = day.consumedCalories > day.targetCalories * 1.05;
              const dayFillPct =
                day.targetCalories > 0
                  ? Math.min(100, Math.round((day.consumedCalories / day.targetCalories) * 100))
                  : 0;
              const cyclingBadge =
                day.dayType === 'high' || day.cyclingOffset > 0
                  ? { symbol: '+', className: 'text-[#2EE6A6]' }
                  : day.dayType === 'low' || day.cyclingOffset < 0
                    ? { symbol: '-', className: 'text-[#FFB020]' }
                    : null;

              return (
                <div
                  key={day.date}
                  title={`${day.date} (${day.dayLabel}): ${day.consumedCalories.toLocaleString()} / ${day.targetCalories.toLocaleString()} kcal${
                    day.cyclingOffset !== 0
                      ? ` (${day.cyclingOffset > 0 ? '+' : ''}${day.cyclingOffset} kcal)`
                      : ''
                  }`}
                  className={`min-w-[72px] shrink-0 snap-start rounded-xl border px-2 py-2 text-center transition sm:min-w-0 sm:shrink sm:px-2 ${
                    day.isToday
                      ? 'border-[#2EE6A6]/60 bg-[#2EE6A6]/[0.09] ring-1 ring-[#2EE6A6]/60'
                      : 'border-white/5 bg-[#0A0C10]/70'
                  } ${day.isFuture ? 'opacity-65' : ''}`}
                >
                  <div className="flex items-center justify-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-300 sm:gap-1 sm:text-[11px]">
                    <span className={day.isToday ? 'text-[#2EE6A6]' : 'text-slate-300'}>
                      {day.dayLabel}
                    </span>
                    {cyclingBadge ? (
                      <span className={`font-bold ${cyclingBadge.className}`}>
                        {cyclingBadge.symbol}
                      </span>
                    ) : null}
                  </div>

                  <div className="tabular-nums mt-1 truncate text-[11px] font-bold text-white sm:text-xs">
                    {day.consumedCalories > 0 ? day.consumedCalories.toLocaleString() : '—'}
                  </div>
                  <div className="tabular-nums truncate text-[9px] text-slate-500 sm:text-[10px]">
                    /{day.targetCalories.toLocaleString()}
                  </div>

                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full ${
                        isDayOver ? 'bg-[#FF5C6C]' : day.isToday ? 'bg-[#2EE6A6]' : 'bg-[#38BDF8]'
                      }`}
                      style={{ width: `${dayFillPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </BentoCard>
  );
}
