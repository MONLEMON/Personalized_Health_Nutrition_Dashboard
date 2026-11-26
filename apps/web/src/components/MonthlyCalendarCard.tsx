import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CalendarDayStatus,
  CalendarDaySummaryDTO,
  DashboardTodayResponse,
  MonthlyCalendarResponse,
} from '@health-dash/shared';
import {
  Activity,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Flame,
  HeartPulse,
  Moon,
  Pill,
  RefreshCw,
  Scale,
  Utensils,
} from 'lucide-react';
import { fetchMonthlyCalendar } from '../lib/api';
import { BentoCard } from './BentoCard';

export interface MonthlyCalendarCardProps {
  todayDate: string;
  refreshTrigger?: number;
  isDemoFallback?: boolean;
  fallbackDashboard?: DashboardTodayResponse | null;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const STATUS_DOT_CLASS: Record<CalendarDayStatus, string> = {
  optimal: 'bg-[#2EE6A6]',
  moderate: 'bg-[#FFB020]',
  overload: 'bg-[#FF5C6C]',
  empty: 'bg-slate-600/50',
};

const STATUS_CELL_RING_CLASS: Record<CalendarDayStatus, string> = {
  optimal: 'border-[#2EE6A6]/30 bg-[#2EE6A6]/[0.06] hover:border-[#2EE6A6]/55',
  moderate: 'border-[#FFB020]/30 bg-[#FFB020]/[0.06] hover:border-[#FFB020]/55',
  overload: 'border-[#FF5C6C]/30 bg-[#FF5C6C]/[0.06] hover:border-[#FF5C6C]/55',
  empty: 'border-white/5 bg-[#0F131C]/55 hover:border-white/15',
};

const STATUS_BADGE: Record<CalendarDayStatus, { label: string; className: string }> = {
  optimal: {
    label: 'Optimal',
    className: 'border-[#2EE6A6]/35 bg-[#2EE6A6]/12 text-[#2EE6A6]',
  },
  moderate: {
    label: 'Moderate',
    className: 'border-[#FFB020]/35 bg-[#FFB020]/12 text-[#FFB020]',
  },
  overload: {
    label: 'Overload',
    className: 'border-[#FF5C6C]/35 bg-[#FF5C6C]/12 text-[#FF5C6C]',
  },
  empty: {
    label: 'No Logs',
    className: 'border-white/10 bg-white/[0.04] text-slate-400',
  },
};

function getDaysInMonth(year: number, monthNum: number): number {
  return new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
}

function getFirstDayOffset(year: number, monthNum: number): number {
  return new Date(Date.UTC(year, monthNum - 1, 1)).getUTCDay();
}

function shiftMonth(ym: string, delta: number): string {
  const [yStr, mStr] = ym.split('-');
  const year = Number(yStr);
  const month = Number(mStr);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  const nextYear = date.getUTCFullYear();
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${nextYear}-${nextMonth}`;
}

function formatMonthHeading(ym: string): string {
  const [yStr, mStr] = ym.split('-');
  const date = new Date(Date.UTC(Number(yStr), Number(mStr) - 1, 1));
  if (Number.isNaN(date.getTime())) return ym;
  return date.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatDayDetailDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const date = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2])));
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function pickDefaultSelectedDate(data: MonthlyCalendarResponse): string | null {
  if (data.days.some((d) => d.date === data.today)) {
    return data.today;
  }
  const firstLogged = data.days.find((d) => d.hasData);
  if (firstLogged) {
    return firstLogged.date;
  }
  return data.days[0]?.date ?? null;
}

function buildFallbackMonthlyCalendar(
  month: string,
  todayDate: string,
  dashboard?: DashboardTodayResponse | null,
): MonthlyCalendarResponse {
  const [yStr, mStr] = month.split('-');
  const year = Number(yStr);
  const monthNum = Number(mStr);
  const daysInMonth = getDaysInMonth(year, monthNum);
  const targetCalories = dashboard?.energy.targetCalories ?? 2480;
  const baselineTdee = dashboard?.energy.baselineTdee ?? 2320;
  const proteinTargetG = dashboard?.macros.protein.target ?? 150;
  const suppTotal = dashboard?.supplements.length ?? 5;

  const days: CalendarDaySummaryDTO[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = `${month}-${String(day).padStart(2, '0')}`;
    if (dashboard && dateStr === todayDate) {
      days.push({
        date: dateStr,
        hasData: true,
        status: dashboard.readiness.status,
        consumedCalories: dashboard.energy.consumedCalories,
        targetCalories: dashboard.energy.targetCalories,
        dynamicTdee: dashboard.energy.dynamicTdee,
        activeCalories: dashboard.energy.activeCalories,
        proteinG: dashboard.macros.protein.consumed,
        proteinTargetG: dashboard.macros.protein.target,
        carbsG: dashboard.macros.carbs.consumed,
        fatG: dashboard.macros.fat.consumed,
        mealCount: dashboard.meals.length,
        workoutCount: dashboard.workouts.length,
        supplementsTaken: dashboard.supplements.filter((s) => s.taken).length,
        supplementsTotal: suppTotal,
        weightKg: dashboard.latestMetric.weightKg,
        bodyFatPct: dashboard.latestMetric.bodyFatPct,
        sleepHours: dashboard.latestMetric.sleepHours ?? null,
        restingHr: dashboard.latestMetric.restingHr ?? null,
      });
      continue;
    }

    const isPastInCurrentMonth = dateStr < todayDate && month === todayDate.slice(0, 7);
    if (isPastInCurrentMonth && day % 2 === 1) {
      const hasWorkout = day % 3 !== 0;
      const activeCal = hasWorkout ? 320 + (day % 4) * 55 : 0;
      const status: CalendarDayStatus =
        day % 7 === 0 ? 'overload' : day % 5 === 0 ? 'moderate' : 'optimal';
      const consumedCal =
        status === 'overload'
          ? Math.round(targetCalories * 1.15)
          : status === 'moderate'
            ? Math.round(targetCalories * 0.82)
            : Math.round(targetCalories * 0.96);
      days.push({
        date: dateStr,
        hasData: true,
        status,
        consumedCalories: consumedCal,
        targetCalories,
        dynamicTdee: baselineTdee + activeCal,
        activeCalories: activeCal,
        proteinG: Math.round(proteinTargetG * (status === 'optimal' ? 0.95 : 0.78)),
        proteinTargetG,
        carbsG: Math.round((consumedCal * 0.45) / 4),
        fatG: Math.round((consumedCal * 0.25) / 9),
        mealCount: 3,
        workoutCount: hasWorkout ? 1 : 0,
        supplementsTaken: status === 'optimal' ? suppTotal : Math.max(0, suppTotal - 1),
        supplementsTotal: suppTotal,
        weightKg: day % 4 === 1 ? Number((75.8 - day * 0.03).toFixed(1)) : null,
        bodyFatPct: day % 4 === 1 ? Number((17.0 - day * 0.02).toFixed(1)) : null,
        sleepHours: day % 4 === 1 ? 7.4 : null,
        restingHr: day % 4 === 1 ? 54 : null,
      });
      continue;
    }

    days.push({
      date: dateStr,
      hasData: false,
      status: 'empty',
      consumedCalories: 0,
      targetCalories,
      dynamicTdee: baselineTdee,
      activeCalories: 0,
      proteinG: 0,
      proteinTargetG,
      carbsG: 0,
      fatG: 0,
      mealCount: 0,
      workoutCount: 0,
      supplementsTaken: 0,
      supplementsTotal: suppTotal,
      weightKg: null,
      bodyFatPct: null,
      sleepHours: null,
      restingHr: null,
    });
  }

  const loggedDaysList = days.filter((d) => d.hasData);
  const mealDays = loggedDaysList.filter((d) => d.consumedCalories > 0);
  const weightDays = loggedDaysList.filter((d) => d.weightKg !== null);
  const suppTakenTotal = loggedDaysList.reduce((sum, d) => sum + d.supplementsTaken, 0);
  const suppPossibleTotal = loggedDaysList.reduce((sum, d) => sum + d.supplementsTotal, 0);

  return {
    month,
    daysInMonth,
    today: todayDate,
    days,
    summary: {
      loggedDays: loggedDaysList.length,
      optimalDays: loggedDaysList.filter((d) => d.status === 'optimal').length,
      moderateDays: loggedDaysList.filter((d) => d.status === 'moderate').length,
      overloadDays: loggedDaysList.filter((d) => d.status === 'overload').length,
      avgCalories:
        mealDays.length > 0
          ? Math.round(mealDays.reduce((sum, d) => sum + d.consumedCalories, 0) / mealDays.length)
          : 0,
      avgProteinG:
        mealDays.length > 0
          ? Math.round(mealDays.reduce((sum, d) => sum + d.proteinG, 0) / mealDays.length)
          : 0,
      totalActiveCalories: loggedDaysList.reduce((sum, d) => sum + d.activeCalories, 0),
      avgWeightKg:
        weightDays.length > 0
          ? Number(
              (
                weightDays.reduce((sum, d) => sum + (d.weightKg ?? 0), 0) / weightDays.length
              ).toFixed(1),
            )
          : null,
      supplementAdherencePct:
        suppPossibleTotal > 0 ? Math.round((suppTakenTotal / suppPossibleTotal) * 100) : 0,
    },
  };
}

export function MonthlyCalendarCard({
  todayDate,
  refreshTrigger = 0,
  isDemoFallback = false,
  fallbackDashboard = null,
}: MonthlyCalendarCardProps) {
  const todayMonth = todayDate.slice(0, 7);
  const [month, setMonth] = useState<string>(todayMonth);
  const [calendarData, setCalendarData] = useState<MonthlyCalendarResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(todayDate);
  const [loading, setLoading] = useState<boolean>(!isDemoFallback);
  const [error, setError] = useState<string | null>(null);

  const monthCacheRef = useRef<Map<string, MonthlyCalendarResponse>>(new Map());
  const lastRefreshTriggerRef = useRef<number>(refreshTrigger);
  const requestSeqRef = useRef<number>(0);

  const loadMonth = useCallback(
    async (targetMonth: string, forceNetwork = false) => {
      if (isDemoFallback) {
        const mockCal = buildFallbackMonthlyCalendar(targetMonth, todayDate, fallbackDashboard);
        setCalendarData(mockCal);
        setLoading(false);
        setError(null);
        setSelectedDate((prev) =>
          prev && mockCal.days.some((d) => d.date === prev)
            ? prev
            : pickDefaultSelectedDate(mockCal),
        );
        return;
      }

      if (!forceNetwork) {
        const cached = monthCacheRef.current.get(targetMonth);
        if (cached) {
          setCalendarData(cached);
          setLoading(false);
          setError(null);
          setSelectedDate((prev) =>
            prev && cached.days.some((d) => d.date === prev)
              ? prev
              : pickDefaultSelectedDate(cached),
          );
          return;
        }
      }

      const seq = ++requestSeqRef.current;
      setLoading(true);
      setError(null);

      try {
        const response = await fetchMonthlyCalendar(targetMonth);
        if (requestSeqRef.current !== seq) return;
        monthCacheRef.current.set(targetMonth, response);
        setCalendarData(response);
        setSelectedDate((prev) =>
          prev && response.days.some((d) => d.date === prev)
            ? prev
            : pickDefaultSelectedDate(response),
        );
      } catch (err) {
        if (requestSeqRef.current !== seq) return;
        setError(err instanceof Error ? err.message : 'Unable to load monthly calendar');
      } finally {
        if (requestSeqRef.current === seq) {
          setLoading(false);
        }
      }
    },
    [fallbackDashboard, isDemoFallback, todayDate],
  );

  useEffect(() => {
    const refreshChanged = refreshTrigger !== lastRefreshTriggerRef.current;
    if (refreshChanged) {
      lastRefreshTriggerRef.current = refreshTrigger;
      monthCacheRef.current.clear();
    }
    void loadMonth(month, refreshChanged);
  }, [month, refreshTrigger, loadMonth]);

  const firstDayOffset = useMemo(() => {
    const [yStr, mStr] = month.split('-');
    return getFirstDayOffset(Number(yStr), Number(mStr));
  }, [month]);

  const selectedDay = useMemo(() => {
    if (!calendarData) return null;
    return (
      calendarData.days.find((d) => d.date === selectedDate) ??
      calendarData.days.find((d) => d.date === calendarData.today) ??
      calendarData.days[0] ??
      null
    );
  }, [calendarData, selectedDate]);

  const handleJumpToday = () => {
    setSelectedDate(todayDate);
    if (month !== todayMonth) {
      setMonth(todayMonth);
    }
  };

  const summary = calendarData?.summary;
  const isViewingTodayMonth = month === todayMonth;

  const progressPct =
    selectedDay && selectedDay.targetCalories > 0
      ? Math.round((selectedDay.consumedCalories / selectedDay.targetCalories) * 100)
      : 0;
  const progressBarColor =
    selectedDay?.status === 'overload'
      ? 'bg-[#FF5C6C]'
      : selectedDay?.status === 'moderate'
        ? 'bg-[#FFB020]'
        : 'bg-[#2EE6A6]';

  return (
    <BentoCard
      title="Monthly Daily Summary"
      subtitle="Calorie adherence, training burn & biometric history"
      icon={<CalendarIcon className="h-4 w-4 text-[#38BDF8]" />}
      accentGlow="sky"
      headerRight={
        <div className="flex w-full items-center justify-between gap-1.5 sm:w-auto sm:justify-end">
          <button
            type="button"
            onClick={() => setMonth((prev) => shiftMonth(prev, -1))}
            aria-label="Previous month"
            className="flex min-h-[38px] min-w-[38px] shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>

          <span className="min-w-0 flex-1 truncate text-center text-xs font-semibold text-white sm:min-w-[122px] sm:flex-none sm:text-sm">
            {formatMonthHeading(month)}
          </span>

          <button
            type="button"
            onClick={() => setMonth((prev) => shiftMonth(prev, 1))}
            aria-label="Next month"
            className="flex min-h-[38px] min-w-[38px] shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={handleJumpToday}
            disabled={isViewingTodayMonth && selectedDate === todayDate}
            className="ml-1 min-h-[38px] shrink-0 rounded-xl border border-[#38BDF8]/30 bg-[#38BDF8]/12 px-3 text-xs font-semibold text-[#38BDF8] transition hover:bg-[#38BDF8]/20 disabled:cursor-default disabled:opacity-45"
          >
            Today
          </button>
        </div>
      }
    >
      <div className="min-w-0 space-y-4">
        {/* Monthly KPI Roll-up Strip */}
        {summary ? (
          <div className="grid grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-4">
            <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/80 p-3 sm:px-3.5 sm:py-2.5">
              <div className="truncate text-[11px] text-slate-400">Logged Days</div>
              <div className="tabular-nums mt-0.5 text-sm font-bold text-white sm:text-base">
                {summary.loggedDays}
                <span className="ml-1 text-xs font-normal text-slate-400">
                  / {calendarData?.daysInMonth ?? 30}
                </span>
              </div>
              <div className="tabular-nums mt-0.5 truncate text-[11px] text-slate-400">
                Supp Adherence {summary.supplementAdherencePct}%
              </div>
            </div>

            <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/80 p-3 sm:px-3.5 sm:py-2.5">
              <div className="truncate text-[11px] text-slate-400">Optimal Days</div>
              <div className="tabular-nums mt-0.5 text-sm font-bold text-[#2EE6A6] sm:text-base">
                {summary.optimalDays}
              </div>
              <div className="tabular-nums mt-0.5 truncate text-[11px] text-slate-400">
                {summary.moderateDays} mod · {summary.overloadDays} over
              </div>
            </div>

            <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/80 p-3 sm:px-3.5 sm:py-2.5">
              <div className="truncate text-[11px] text-slate-400">Avg Daily Intake</div>
              <div className="tabular-nums mt-0.5 text-sm font-bold text-white sm:text-base">
                {summary.avgCalories.toLocaleString()}{' '}
                <span className="text-xs font-normal text-slate-400">kcal</span>
              </div>
              <div className="tabular-nums mt-0.5 truncate text-[11px] text-[#2EE6A6]">
                Avg Protein {summary.avgProteinG}g
              </div>
            </div>

            <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/80 p-3 sm:px-3.5 sm:py-2.5">
              <div className="truncate text-[11px] text-slate-400">Total Active Burn</div>
              <div className="tabular-nums mt-0.5 text-sm font-bold text-[#FFB020] sm:text-base">
                +{summary.totalActiveCalories.toLocaleString()}{' '}
                <span className="text-xs font-normal text-slate-400">kcal</span>
              </div>
              <div className="tabular-nums mt-0.5 truncate text-[11px] text-slate-400">
                Avg Weight:{' '}
                {summary.avgWeightKg !== null ? `${summary.avgWeightKg.toFixed(1)} kg` : '—'}
              </div>
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-[#FF5C6C]/30 bg-[#FF5C6C]/10 px-3.5 py-2.5 text-xs text-[#FF8A95]">
            <span className="min-w-0 flex-1 break-words">{error}</span>
            <button
              type="button"
              onClick={() => void loadMonth(month, true)}
              className="inline-flex min-h-[34px] shrink-0 items-center gap-1 rounded-xl bg-white/10 px-2.5 py-1 font-semibold text-white transition hover:bg-white/20"
            >
              <RefreshCw className="h-3 w-3" />
              Retry
            </button>
          </div>
        ) : null}

        {/* Calendar Grid */}
        {loading && !calendarData ? (
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {Array.from({ length: 35 }).map((_, idx) => (
              <div
                key={idx}
                className="min-h-[46px] animate-pulse rounded-xl border border-white/5 bg-[#0F131C]/70 sm:h-16"
              />
            ))}
          </div>
        ) : calendarData ? (
          <div className="min-w-0">
            {/* Legend */}
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#2EE6A6]" />
                  Optimal
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#FFB020]" />
                  Moderate
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#FF5C6C]" />
                  Overload
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-1">
                  <Dumbbell className="h-3 w-3 text-[#FFB020]" />
                  Workout
                </span>
                <span className="inline-flex items-center gap-1">
                  <Scale className="h-3 w-3 text-[#38BDF8]" />
                  Weigh-in
                </span>
              </div>
            </div>

            {/* Weekday Header */}
            <div className="mb-1.5 grid grid-cols-7 gap-1 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 sm:gap-1.5 sm:text-[11px]">
              {WEEKDAY_LABELS.map((day) => (
                <div key={day} className="min-w-0 truncate py-1">
                  {day}
                </div>
              ))}
            </div>

            {/* 7-column Days Grid */}
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {Array.from({ length: firstDayOffset }).map((_, offsetIdx) => (
                <div key={`offset-${offsetIdx}`} aria-hidden="true" className="min-h-[46px] sm:min-h-[64px]" />
              ))}

              {calendarData.days.map((day) => {
                const dayNumber = Number(day.date.slice(8, 10));
                const isToday = day.date === calendarData.today || day.date === todayDate;
                const isSelected = selectedDay?.date === day.date;

                return (
                  <button
                    key={day.date}
                    type="button"
                    onClick={() => setSelectedDate(day.date)}
                    aria-label={`${day.date}, ${STATUS_BADGE[day.status].label}`}
                    aria-pressed={isSelected}
                    className={`relative flex min-w-0 min-h-[46px] cursor-pointer flex-col justify-between rounded-xl border p-1 text-left transition sm:min-h-[64px] sm:p-2 ${
                      STATUS_CELL_RING_CLASS[day.status]
                    } ${isToday ? 'ring-1 ring-[#38BDF8]' : ''} ${
                      isSelected ? 'ring-2 ring-white/60 bg-white/[0.08]' : ''
                    }`}
                  >
                    <div className="flex w-full items-center justify-between gap-0.5 sm:gap-1">
                      <span
                        className={`tabular-nums text-[11px] font-semibold sm:text-xs ${
                          isToday ? 'text-[#38BDF8]' : day.hasData ? 'text-white' : 'text-slate-500'
                        }`}
                      >
                        {dayNumber}
                      </span>
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT_CLASS[day.status]}`}
                      />
                    </div>

                    <div className="flex w-full items-end justify-between gap-0.5 sm:gap-1">
                      {day.consumedCalories > 0 ? (
                        <span className="tabular-nums hidden truncate text-[10px] font-medium text-slate-300 sm:inline">
                          {day.consumedCalories.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-[10px] text-transparent">.</span>
                      )}

                      <div className="flex items-center gap-0.5 sm:gap-1">
                        {day.workoutCount > 0 ? (
                          <span
                            title={`${day.workoutCount} workout(s)`}
                            className="h-1.5 w-1.5 rounded-full bg-[#FFB020]"
                          />
                        ) : null}
                        {day.weightKg !== null ? (
                          <span
                            title={`Weight: ${day.weightKg} kg`}
                            className="h-1.5 w-1.5 rounded-full bg-[#38BDF8]"
                          />
                        ) : null}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {/* Selected Day Detail Panel */}
        {selectedDay ? (
          <div className="min-w-0 rounded-2xl border border-white/10 bg-[#0F131C]/85 p-3.5 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-white">
                  {formatDayDetailDate(selectedDay.date)}
                </h3>
                {selectedDay.date === calendarData?.today || selectedDay.date === todayDate ? (
                  <span className="rounded-full border border-[#38BDF8]/30 bg-[#38BDF8]/12 px-2 py-0.5 text-[10px] font-semibold text-[#38BDF8]">
                    Today
                  </span>
                ) : null}
              </div>

              <span
                className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                  STATUS_BADGE[selectedDay.status].className
                }`}
              >
                {STATUS_BADGE[selectedDay.status].label}
              </span>
            </div>

            {!selectedDay.hasData ? (
              <p className="mt-3 text-xs text-slate-400">
                No nutrition, workout, or biometric logs recorded on this date.
              </p>
            ) : (
              <div className="mt-3 space-y-3">
                {/* Consumed vs Target Progress Bar */}
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-1.5 text-slate-300">
                      <Flame className="h-3.5 w-3.5 text-[#FFB020]" />
                      Consumed vs Target
                    </span>
                    <span className="tabular-nums font-semibold text-white">
                      {selectedDay.consumedCalories.toLocaleString()} /{' '}
                      {selectedDay.targetCalories.toLocaleString()} kcal ({progressPct}%)
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${progressBarColor}`}
                      style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
                    />
                  </div>
                </div>

                {/* Dynamic TDEE, Active kcal, Macro Pills */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="tabular-nums rounded-xl border border-white/10 bg-[#0A0C10]/80 px-2.5 py-1 text-slate-300">
                      Dynamic TDEE:{' '}
                      <strong className="text-white">
                        {selectedDay.dynamicTdee.toLocaleString()} kcal
                      </strong>
                    </span>
                    <span className="tabular-nums rounded-xl border border-[#FFB020]/25 bg-[#FFB020]/10 px-2.5 py-1 font-semibold text-[#FFB020]">
                      +{selectedDay.activeCalories.toLocaleString()} active kcal
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="tabular-nums rounded-lg bg-[#2EE6A6]/12 px-2 py-1 text-[11px] font-semibold text-[#2EE6A6]">
                      P {selectedDay.proteinG}/{selectedDay.proteinTargetG}g
                    </span>
                    <span className="tabular-nums rounded-lg bg-[#38BDF8]/12 px-2 py-1 text-[11px] font-semibold text-[#38BDF8]">
                      C {selectedDay.carbsG}g
                    </span>
                    <span className="tabular-nums rounded-lg bg-[#FBBF24]/12 px-2 py-1 text-[11px] font-semibold text-[#FBBF24]">
                      F {selectedDay.fatG}g
                    </span>
                  </div>
                </div>

                {/* Counts & Recorded Biometrics */}
                <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-2.5 text-xs text-slate-300">
                  <span className="tabular-nums inline-flex items-center gap-1 rounded-xl border border-white/5 bg-white/[0.03] px-2.5 py-1">
                    <Utensils className="h-3 w-3 text-[#2EE6A6]" />
                    {selectedDay.mealCount} meals
                  </span>
                  <span className="tabular-nums inline-flex items-center gap-1 rounded-xl border border-white/5 bg-white/[0.03] px-2.5 py-1">
                    <Activity className="h-3 w-3 text-[#FFB020]" />
                    {selectedDay.workoutCount} workouts
                  </span>
                  <span className="tabular-nums inline-flex items-center gap-1 rounded-xl border border-white/5 bg-white/[0.03] px-2.5 py-1">
                    <Pill className="h-3 w-3 text-[#2EE6A6]" />
                    Supp {selectedDay.supplementsTaken}/{selectedDay.supplementsTotal}
                  </span>

                  {selectedDay.weightKg !== null ? (
                    <span className="tabular-nums inline-flex items-center gap-1 rounded-xl border border-[#38BDF8]/20 bg-[#38BDF8]/10 px-2.5 py-1 font-medium text-[#38BDF8]">
                      <Scale className="h-3 w-3" />
                      {selectedDay.weightKg.toFixed(1)} kg
                    </span>
                  ) : null}

                  {selectedDay.bodyFatPct !== null ? (
                    <span className="tabular-nums inline-flex items-center gap-1 rounded-xl border border-[#FFB020]/20 bg-[#FFB020]/10 px-2.5 py-1 font-medium text-[#FFB020]">
                      BF {selectedDay.bodyFatPct.toFixed(1)}%
                    </span>
                  ) : null}

                  {selectedDay.sleepHours !== null ? (
                    <span className="tabular-nums inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1 text-slate-200">
                      <Moon className="h-3 w-3 text-[#38BDF8]" />
                      {selectedDay.sleepHours.toFixed(1)}h
                    </span>
                  ) : null}

                  {selectedDay.restingHr !== null ? (
                    <span className="tabular-nums inline-flex items-center gap-1 rounded-xl border border-[#FF5C6C]/20 bg-[#FF5C6C]/10 px-2.5 py-1 font-medium text-[#FF8A95]">
                      <HeartPulse className="h-3 w-3" />
                      {selectedDay.restingHr} bpm
                    </span>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </BentoCard>
  );
}
