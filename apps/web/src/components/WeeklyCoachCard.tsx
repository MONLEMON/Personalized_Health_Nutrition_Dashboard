import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CoachRecommendationReasonCode,
  EnergySummary,
  GoalType,
  UserGoalDTO,
  WeeklyCoachAiNarrativeDTO,
  WeeklyCoachMetricsDTO,
  WeeklyCoachRecommendationDTO,
  WeeklyCoachReportDTO,
  WeeklyCoachStatusResponse,
} from '@health-dash/shared';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flame,
  HeartPulse,
  ListChecks,
  Loader2,
  Moon,
  RefreshCw,
  Scale,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Trophy,
} from 'lucide-react';
import {
  applyWeeklyCoachRecommendation,
  fetchWeeklyCoachStatus,
  generateWeeklyCoachReport,
} from '../lib/api';
import { BentoCard } from './BentoCard';

export interface WeeklyCoachCardProps {
  todayDate: string;
  refreshTrigger?: number;
  isDemoFallback?: boolean;
  fallbackGoal?: UserGoalDTO;
  fallbackEnergy?: EnergySummary;
  onTargetApplied?: () => Promise<void> | void;
}

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function getWeekStart(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  return shiftIsoDate(isoDate, diffToMonday);
}

function formatSignedNumber(value: number, decimals = 0): string {
  const formatted = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toLocaleString();
  return value > 0 ? `+${formatted}` : formatted;
}

function evaluateDemoRecommendation(
  metrics: WeeklyCoachMetricsDTO,
  goal?: UserGoalDTO,
): WeeklyCoachRecommendationDTO {
  const goalType: GoalType = goal?.goalType ?? 'CUT';
  const currentAdj = goal?.calorieAdjustment ?? -350;

  if (metrics.daysLogged < 5 || metrics.weightDeltaPct === null) {
    return {
      direction: 'MAINTAIN',
      deltaKcal: 0,
      currentCalorieAdjustment: currentAdj,
      suggestedCalorieAdjustment: currentAdj,
      reasonCode: 'INSUFFICIENT_DATA',
      canApply: false,
    };
  }

  const pct = metrics.weightDeltaPct;
  let deltaKcal = 0;
  let reasonCode: CoachRecommendationReasonCode = 'ON_TRACK';

  if (goalType === 'CUT') {
    if (pct < -0.9) {
      deltaKcal = 125;
      reasonCode = 'CUT_TOO_FAST';
    } else if (pct > -0.2) {
      deltaKcal = -125;
      reasonCode = 'CUT_TOO_SLOW';
    }
  } else if (goalType === 'BULK') {
    if (pct < 0.1) {
      deltaKcal = 125;
      reasonCode = 'BULK_TOO_SLOW';
    } else if (pct > 0.55) {
      deltaKcal = -125;
      reasonCode = 'BULK_TOO_FAST';
    }
  } else if (pct > 0.35) {
    deltaKcal = -100;
    reasonCode = 'MAINTAIN_GAINING';
  } else if (pct < -0.35) {
    deltaKcal = 100;
    reasonCode = 'MAINTAIN_LOSING';
  }

  const suggested = Math.max(-1200, Math.min(1200, currentAdj + deltaKcal));
  const direction = deltaKcal > 0 ? 'INCREASE' : deltaKcal < 0 ? 'DECREASE' : 'MAINTAIN';

  return {
    direction,
    deltaKcal,
    currentCalorieAdjustment: currentAdj,
    suggestedCalorieAdjustment: suggested,
    reasonCode,
    canApply: deltaKcal !== 0 && suggested !== currentAdj,
  };
}

function buildDemoStatus(
  weekStartDate: string,
  currentWeekStart: string,
  fallbackGoal?: UserGoalDTO,
  fallbackEnergy?: EnergySummary,
  existingReport: WeeklyCoachReportDTO | null = null,
): WeeklyCoachStatusResponse {
  const weekEndDate = shiftIsoDate(weekStartDate, 6);
  const isCurrent = weekStartDate === currentWeekStart;
  const estimatedTdee = fallbackEnergy?.dynamicTdee ?? 2680;
  const avgTargetCalories = fallbackEnergy?.targetCalories ?? 2330;
  const avgProteinTargetG = Math.round(74.9 * (fallbackGoal?.proteinPerKg ?? 2.0));
  const avgIntakeCalories = isCurrent ? avgTargetCalories + 95 : avgTargetCalories - 45;
  const avgProteinG = isCurrent ? Math.max(0, avgProteinTargetG - 6) : avgProteinTargetG + 4;
  const weightDeltaKg = isCurrent ? -0.1 : -0.35;
  const previousWeightMa7 = isCurrent ? 75.0 : 75.35;
  const currentWeightMa7 = Number((previousWeightMa7 + weightDeltaKg).toFixed(1));
  const weightDeltaPct = Number(((weightDeltaKg / previousWeightMa7) * 100).toFixed(2));
  const observedTdee = Math.max(
    1000,
    Math.min(6000, Math.round(avgIntakeCalories - (weightDeltaKg * 7700) / 7)),
  );

  const liveMetrics: WeeklyCoachMetricsDTO = {
    weekStartDate,
    weekEndDate,
    daysLogged: isCurrent ? 6 : 7,
    avgIntakeCalories,
    avgTargetCalories,
    avgProteinG,
    avgProteinTargetG,
    proteinAdherencePct:
      avgProteinTargetG > 0 ? Math.round((avgProteinG / avgProteinTargetG) * 100) : 100,
    calorieAdherencePct:
      avgTargetCalories > 0 ? Math.round((avgIntakeCalories / avgTargetCalories) * 100) : 100,
    totalActiveCalories: isCurrent ? 1890 : 2140,
    workoutDays: isCurrent ? 4 : 5,
    supplementAdherencePct: isCurrent ? 86 : 94,
    weekdayAvgCalories: avgTargetCalories - 40,
    weekendAvgCalories: avgTargetCalories + 340,
    currentWeightMa7,
    previousWeightMa7,
    weightDeltaKg,
    weightDeltaPct,
    observedTdee,
    estimatedTdee,
    avgSleepHours: 7.4,
    avgRestingHr: 54,
  };

  const liveRecommendation = evaluateDemoRecommendation(liveMetrics, fallbackGoal);

  return {
    report: existingReport,
    liveMetrics,
    liveRecommendation,
  };
}

function buildDemoReport(
  weekStartDate: string,
  status: WeeklyCoachStatusResponse,
): WeeklyCoachReportDTO {
  const { liveMetrics: m, liveRecommendation: r } = status;
  const score = Math.max(
    40,
    Math.min(
      98,
      Math.round(
        78 +
          (m.proteinAdherencePct >= 90 ? 8 : 2) +
          (m.workoutDays >= 4 ? 6 : 0) -
          (r.deltaKcal !== 0 ? 4 : 0),
      ),
    ),
  );

  const narrative: WeeklyCoachAiNarrativeDTO = {
    weeklyScore: score,
    headline:
      r.deltaKcal < 0
        ? 'โปรตีนและวินัยการซ้อมดีเยี่ยม แนะนำปรับลดแคลอรี่เล็กน้อยเพื่อเร่งอัตรา Cut'
        : r.deltaKcal > 0
          ? 'น้ำหนักลดเร็วกว่าเป้าหมายเล็กน้อย แนะนำเติมพลังงานเพิ่มเพื่อรักษามวลกล้ามเนื้อ'
          : 'สมดุลพลังงานและแนวโน้มน้ำหนัก 7 วันอยู่ในโซนเป้าหมายอย่างยอดเยี่ยม',
    summary: `สัปดาห์นี้คุณบันทึกอาหารครบ ${m.daysLogged} วัน เฉลี่ย ${m.avgIntakeCalories.toLocaleString()} kcal/วัน (เป้าหมาย ${m.avgTargetCalories.toLocaleString()} kcal) และรักษาโปรตีนได้ ${m.proteinAdherencePct}% พร้อมเผาผลาญจากการออกกำลังกาย +${m.totalActiveCalories.toLocaleString()} kcal`,
    wins: [
      `ทำโปรตีนเฉลี่ยได้ ${m.avgProteinG}g/วัน (${m.proteinAdherencePct}% ของเป้า)`,
      `ออกกำลังกายสม่ำเสมอ ${m.workoutDays} วัน เผาผลาญรวม +${m.totalActiveCalories.toLocaleString()} kcal`,
      m.avgSleepHours !== null
        ? `คุณภาพการฟื้นตัวดี นอนเฉลี่ย ${m.avgSleepHours.toFixed(1)} ชม. (RHR ${m.avgRestingHr ?? 54} bpm)`
        : `ความสม่ำเสมออาหารเสริมอยู่ที่ ${m.supplementAdherencePct}%`,
    ],
    bottlenecks: [
      m.weekendAvgCalories !== null &&
      m.weekdayAvgCalories !== null &&
      m.weekendAvgCalories - m.weekdayAvgCalories > 200
        ? `แคลอรี่วันหยุด (${m.weekendAvgCalories.toLocaleString()} kcal) สูงกว่าวันธรรมดา (${m.weekdayAvgCalories.toLocaleString()} kcal)`
        : 'บันทึกน้ำหนักเช้าหลังตื่นนอนให้ครบต่อเนื่องทุกวันเพื่อลดความคลาดเคลื่อนของ 7-Day MA',
    ],
    actionPlan: [
      'รักษาระดับโปรตีน ≥ 90% ทุกวัน โดยเฉพาะมื้อเย็นและวันพัก',
      'พิจารณาเปิด Weekend Buffer ใน Settings หากต้องการยืดหยุ่นมื้อพิเศษวันเสาร์-อาทิตย์',
      'ชั่งน้ำหนักตอนเช้าหลังเข้าห้องน้ำก่อนดื่มน้ำอย่างน้อย 5 วัน/สัปดาห์',
    ],
    adjustmentRationale:
      r.deltaKcal !== 0
        ? `ค่า Observed TDEE อยู่ที่ ${m.observedTdee?.toLocaleString() ?? m.estimatedTdee.toLocaleString()} kcal และแนวโน้มน้ำหนักเปลี่ยนแปลง ${m.weightDeltaPct !== null ? `${m.weightDeltaPct > 0 ? '+' : ''}${m.weightDeltaPct}%` : '—'} จึงแนะนำปรับเป้า ${formatSignedNumber(r.deltaKcal)} kcal/วัน`
        : 'อัตราการเปลี่ยนแปลงน้ำหนัก 7 วันและพลังงานสุทธิสอดคล้องกับเป้าหมาย ไม่จำเป็นต้องปรับเป้าเพิ่มเติม',
    source: 'DETERMINISTIC_FALLBACK',
  };

  return {
    id: `demo-coach-${weekStartDate}`,
    userId: 'demo-user',
    weekStartDate: m.weekStartDate,
    weekEndDate: m.weekEndDate,
    metrics: m,
    recommendation: r,
    narrative,
    appliedAt: null,
    generatedAt: new Date().toISOString(),
  };
}

const REASON_LABELS: Record<CoachRecommendationReasonCode, string> = {
  ON_TRACK: 'Weight trend and intake pace are right on target',
  INSUFFICIENT_DATA: 'Log 5+ meal days and 2 weeks of weigh-ins for Observed TDEE calibration',
  CUT_TOO_SLOW: '7-day weight loss is slower than target cut pace (-0.2% to -0.9%/wk)',
  CUT_TOO_FAST: '7-day weight loss exceeds -0.9%/wk — easing deficit protects lean mass',
  BULK_TOO_SLOW: '7-day weight gain is below +0.1%/wk target lean bulk pace',
  BULK_TOO_FAST: '7-day weight gain exceeds +0.55%/wk — trimming surplus limits fat gain',
  MAINTAIN_GAINING: 'Weight trend is drifting upward (> +0.35%/wk)',
  MAINTAIN_LOSING: 'Weight trend is drifting downward (< -0.35%/wk)',
};

function getWeightTrendColor(
  weightDeltaPct: number | null,
  goalType?: GoalType,
): string {
  if (weightDeltaPct === null) return 'text-slate-300';
  if (goalType === 'CUT') {
    if (weightDeltaPct <= -0.2 && weightDeltaPct >= -0.9) return 'text-[#2EE6A6]';
    if (weightDeltaPct > 0.1 || weightDeltaPct < -1.1) return 'text-[#FF5C6C]';
    return 'text-[#FFB020]';
  }
  if (goalType === 'BULK') {
    if (weightDeltaPct >= 0.1 && weightDeltaPct <= 0.55) return 'text-[#2EE6A6]';
    if (weightDeltaPct < -0.1 || weightDeltaPct > 0.75) return 'text-[#FF5C6C]';
    return 'text-[#FFB020]';
  }
  if (Math.abs(weightDeltaPct) <= 0.35) return 'text-[#2EE6A6]';
  return 'text-[#FFB020]';
}

function WeeklyScoreRing({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const radius = 26;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - clamped / 100);
  const strokeColor =
    clamped >= 80 ? '#2EE6A6' : clamped >= 60 ? '#FFB020' : '#FF5C6C';

  return (
    <div className="relative flex h-16 w-16 shrink-0 items-center justify-center">
      <svg viewBox="0 0 64 64" className="h-full w-full -rotate-90">
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="5"
        />
        <circle
          cx="32"
          cy="32"
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="tabular-nums text-base font-bold text-white">{clamped}</span>
        <span className="text-[9px] font-medium text-slate-400">/100</span>
      </div>
    </div>
  );
}

export function WeeklyCoachCard({
  todayDate,
  refreshTrigger = 0,
  isDemoFallback = false,
  fallbackGoal,
  fallbackEnergy,
  onTargetApplied,
}: WeeklyCoachCardProps) {
  const currentWeekStart = useMemo(() => getWeekStart(todayDate), [todayDate]);
  const [weekStart, setWeekStart] = useState<string>(currentWeekStart);
  const [status, setStatus] = useState<WeeklyCoachStatusResponse | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<boolean>(!isDemoFallback);
  const [generating, setGenerating] = useState<boolean>(false);
  const [applying, setApplying] = useState<boolean>(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastActionFailed, setLastActionFailed] = useState<'generate' | 'apply' | null>(null);

  const demoReportsRef = useRef<Map<string, WeeklyCoachReportDTO>>(new Map());
  const requestSeqRef = useRef<number>(0);
  const prevTodayWeekRef = useRef<string>(currentWeekStart);

  useEffect(() => {
    if (prevTodayWeekRef.current !== currentWeekStart) {
      if (weekStart === prevTodayWeekRef.current) {
        setWeekStart(currentWeekStart);
      }
      prevTodayWeekRef.current = currentWeekStart;
    }
  }, [currentWeekStart, weekStart]);

  const loadWeekStatus = useCallback(
    async (targetWeekStart: string) => {
      setActionError(null);
      setLastActionFailed(null);

      if (isDemoFallback) {
        const cachedReport = demoReportsRef.current.get(targetWeekStart) ?? null;
        const mockStatus = buildDemoStatus(
          targetWeekStart,
          currentWeekStart,
          fallbackGoal,
          fallbackEnergy,
          cachedReport,
        );
        setStatus(mockStatus);
        setLoadingStatus(false);
        setStatusError(null);
        return;
      }

      const seq = ++requestSeqRef.current;
      setLoadingStatus(true);
      setStatusError(null);
      try {
        const res = await fetchWeeklyCoachStatus(targetWeekStart);
        if (requestSeqRef.current !== seq) return;
        setStatus(res);
      } catch (err) {
        if (requestSeqRef.current !== seq) return;
        setStatusError(
          err instanceof Error ? err.message : 'Unable to load weekly coach metrics.',
        );
      } finally {
        if (requestSeqRef.current === seq) {
          setLoadingStatus(false);
        }
      }
    },
    [currentWeekStart, fallbackEnergy, fallbackGoal, isDemoFallback],
  );

  useEffect(() => {
    void loadWeekStatus(weekStart);
  }, [weekStart, refreshTrigger, loadWeekStatus]);

  const report = status?.report ?? null;
  const activeMetrics = report?.metrics ?? status?.liveMetrics ?? null;
  const activeRecommendation = report?.recommendation ?? status?.liveRecommendation ?? null;

  const displayWeekStart = activeMetrics?.weekStartDate ?? weekStart;
  const displayWeekEnd = activeMetrics?.weekEndDate ?? shiftIsoDate(weekStart, 6);
  const isAtCurrentWeek = weekStart >= currentWeekStart;

  const handleGenerate = async () => {
    if (generating || applying) return;
    setGenerating(true);
    setActionError(null);
    setLastActionFailed(null);

    try {
      if (isDemoFallback) {
        const currentStatus =
          status ??
          buildDemoStatus(
            weekStart,
            currentWeekStart,
            fallbackGoal,
            fallbackEnergy,
            demoReportsRef.current.get(weekStart) ?? null,
          );
        const generated = buildDemoReport(weekStart, currentStatus);
        demoReportsRef.current.set(weekStart, generated);
        setStatus({ ...currentStatus, report: generated });
        return;
      }

      const generated = await generateWeeklyCoachReport({
        weekStart,
        force: Boolean(report),
      });
      setStatus((prev) =>
        prev
          ? { ...prev, report: generated }
          : {
              report: generated,
              liveMetrics: generated.metrics,
              liveRecommendation: generated.recommendation,
            },
      );
    } catch (err) {
      setLastActionFailed('generate');
      setActionError(
        err instanceof Error ? err.message : 'Unable to generate Weekly AI Coach report.',
      );
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = async () => {
    if (!report || !report.recommendation.canApply || report.appliedAt || applying || generating) {
      return;
    }
    setApplying(true);
    setActionError(null);
    setLastActionFailed(null);

    try {
      if (isDemoFallback) {
        const updatedReport: WeeklyCoachReportDTO = {
          ...report,
          appliedAt: new Date().toISOString(),
        };
        demoReportsRef.current.set(weekStart, updatedReport);
        setStatus((prev) => (prev ? { ...prev, report: updatedReport } : prev));
        await onTargetApplied?.();
        return;
      }

      const res = await applyWeeklyCoachRecommendation(report.id);
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              report: res.report,
              liveRecommendation: res.report.recommendation,
            }
          : {
              report: res.report,
              liveMetrics: res.report.metrics,
              liveRecommendation: res.report.recommendation,
            },
      );
      await onTargetApplied?.();
    } catch (err) {
      setLastActionFailed('apply');
      setActionError(
        err instanceof Error ? err.message : 'Unable to apply target adjustment.',
      );
    } finally {
      setApplying(false);
    }
  };

  const handlePrevWeek = () => {
    setWeekStart((prev) => shiftIsoDate(prev, -7));
  };

  const handleNextWeek = () => {
    setWeekStart((prev) => {
      const next = shiftIsoDate(prev, 7);
      return next > currentWeekStart ? currentWeekStart : next;
    });
  };

  const formatAdj = (val: number) => (val > 0 ? `+${val}` : `${val}`);

  const deltaBadge = (() => {
    if (!activeRecommendation) return null;
    if (activeRecommendation.reasonCode === 'INSUFFICIENT_DATA') {
      return {
        label: 'Need 5+ Days',
        className: 'border-white/15 bg-white/[0.06] text-slate-300',
        icon: <AlertCircle className="h-3.5 w-3.5 text-slate-400" />,
      };
    }
    if (activeRecommendation.deltaKcal < 0) {
      return {
        label: `${activeRecommendation.deltaKcal} kcal`,
        className: 'border-[#FFB020]/35 bg-[#FFB020]/12 text-[#FFB020]',
        icon: <ArrowDownRight className="h-3.5 w-3.5" />,
      };
    }
    if (activeRecommendation.deltaKcal > 0) {
      return {
        label: `+${activeRecommendation.deltaKcal} kcal`,
        className: 'border-[#38BDF8]/35 bg-[#38BDF8]/12 text-[#38BDF8]',
        icon: <ArrowUpRight className="h-3.5 w-3.5" />,
      };
    }
    return {
      label: 'On Track',
      className: 'border-[#2EE6A6]/35 bg-[#2EE6A6]/12 text-[#2EE6A6]',
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    };
  })();

  return (
    <BentoCard
      title="Weekly AI Nutrition Coach"
      subtitle="Observed TDEE calibration, 7-day trend & adaptive calorie adjustment"
      icon={<BrainCircuit className="h-4 w-4 text-[#2EE6A6]" />}
      accentGlow="mint"
      headerRight={
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end">
          <div className="flex w-full items-center justify-between gap-1 rounded-2xl border border-white/10 bg-[#0A0C10]/70 p-1 sm:w-auto">
            <button
              type="button"
              onClick={handlePrevWeek}
              aria-label="Previous week"
              className="flex min-h-[38px] min-w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-300 transition hover:bg-white/10 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="tabular-nums min-w-0 truncate px-1.5 text-center text-[11px] font-semibold whitespace-nowrap text-white sm:px-2 sm:text-xs">
              {displayWeekStart} → {displayWeekEnd}
            </span>
            <button
              type="button"
              onClick={handleNextWeek}
              disabled={isAtCurrentWeek}
              aria-label="Next week"
              className="flex min-h-[38px] min-w-[38px] shrink-0 cursor-pointer items-center justify-center rounded-xl text-slate-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => void handleGenerate()}
            disabled={generating || applying || loadingStatus}
            className={`inline-flex min-h-[44px] w-full shrink-0 cursor-pointer items-center justify-center gap-2 rounded-2xl px-4 py-2 text-xs font-bold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 sm:w-auto ${
              report
                ? 'border border-[#2EE6A6]/40 bg-[#2EE6A6]/15 text-[#2EE6A6] hover:bg-[#2EE6A6]/25'
                : 'bg-[#2EE6A6] text-[#081016] hover:brightness-110'
            }`}
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Analyzing Week…</span>
              </>
            ) : report ? (
              <>
                <RefreshCw className="h-4 w-4" />
                <span>Regenerate</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                <span>Generate AI Coach</span>
              </>
            )}
          </button>
        </div>
      }
    >
      <div className="min-w-0 space-y-4">
        {/* Status Error Alert */}
        {statusError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#FF5C6C]/35 bg-[#FF5C6C]/12 px-4 py-3 text-xs text-[#FF8A95]"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-[#FF5C6C]" />
              <span className="min-w-0 break-words">{statusError}</span>
            </div>
            <button
              type="button"
              onClick={() => void loadWeekStatus(weekStart)}
              className="inline-flex min-h-[36px] shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5 font-semibold text-white transition hover:bg-white/20"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Retry
            </button>
          </div>
        ) : null}

        {/* Action Error Alert (Generate / Apply) */}
        {actionError ? (
          <div
            role="alert"
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#FF5C6C]/35 bg-[#FF5C6C]/12 px-4 py-3 text-xs text-[#FF8A95]"
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-[#FF5C6C]" />
              <span className="min-w-0 break-words">{actionError}</span>
            </div>
            {lastActionFailed ? (
              <button
                type="button"
                onClick={() =>
                  void (lastActionFailed === 'apply' ? handleApply() : handleGenerate())
                }
                disabled={generating || applying}
                className="inline-flex min-h-[36px] shrink-0 cursor-pointer items-center gap-1.5 rounded-xl bg-white/10 px-3 py-1.5 font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Retry
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Loading Skeleton when initial metrics haven't loaded */}
        {loadingStatus && !activeMetrics ? (
          <div className="grid grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div
                key={idx}
                className="h-24 animate-pulse rounded-2xl border border-white/5 bg-[#0F131C]/80"
              />
            ))}
          </div>
        ) : null}

        {/* 4 KPI Metric Tiles */}
        {activeMetrics ? (
          <div className="grid grid-cols-2 gap-2 sm:gap-2.5 lg:grid-cols-4">
            {/* Tile 1: Observed TDEE */}
            <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/85 p-3 sm:p-3.5">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:text-[11px]">
                <Flame className="h-3.5 w-3.5 shrink-0 text-[#38BDF8]" />
                <span className="truncate">Observed TDEE</span>
              </div>
              {activeMetrics.observedTdee !== null ? (
                <div className="tabular-nums mt-1.5 text-base font-bold text-white sm:text-xl">
                  {activeMetrics.observedTdee.toLocaleString()}{' '}
                  <span className="text-xs font-normal text-slate-400">kcal</span>
                </div>
              ) : (
                <div className="mt-1.5 text-sm font-bold text-[#FFB020] sm:text-base">
                  Need 5+ days
                </div>
              )}
              <div className="tabular-nums mt-1 truncate text-[11px] text-slate-400">
                Estimated TDEE: {activeMetrics.estimatedTdee.toLocaleString()} kcal
              </div>
            </div>

            {/* Tile 2: 7-Day Weight Trend */}
            <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/85 p-3 sm:p-3.5">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:text-[11px]">
                <Scale className="h-3.5 w-3.5 shrink-0 text-[#2EE6A6]" />
                <span className="truncate">7-Day Weight Trend</span>
              </div>
              {activeMetrics.weightDeltaKg !== null ? (
                <div
                  className={`tabular-nums mt-1.5 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-base font-bold sm:text-xl ${getWeightTrendColor(
                    activeMetrics.weightDeltaPct,
                    fallbackGoal?.goalType,
                  )}`}
                >
                  <span>{formatSignedNumber(activeMetrics.weightDeltaKg, 2)} kg</span>
                  {activeMetrics.weightDeltaPct !== null ? (
                    <span className="text-xs font-semibold">
                      ({formatSignedNumber(activeMetrics.weightDeltaPct, 2)}%)
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="mt-1.5 text-sm font-bold text-slate-300 sm:text-base">
                  Need 2 weeks
                </div>
              )}
              <div className="tabular-nums mt-1 truncate text-[11px] text-slate-400">
                {activeMetrics.currentWeightMa7 !== null && activeMetrics.previousWeightMa7 !== null
                  ? `MA7: ${activeMetrics.previousWeightMa7.toFixed(1)} → ${activeMetrics.currentWeightMa7.toFixed(1)} kg`
                  : activeMetrics.currentWeightMa7 !== null
                    ? `Current MA7: ${activeMetrics.currentWeightMa7.toFixed(1)} kg`
                    : 'Log morning weigh-ins'}
              </div>
            </div>

            {/* Tile 3: Avg Intake & Protein Adherence */}
            <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/85 p-3 sm:p-3.5">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:text-[11px]">
                <Target className="h-3.5 w-3.5 shrink-0 text-[#2EE6A6]" />
                <span className="truncate">Avg Intake &amp; Protein</span>
              </div>
              <div className="tabular-nums mt-1.5 text-base font-bold text-white sm:text-xl">
                {activeMetrics.avgIntakeCalories.toLocaleString()}{' '}
                <span className="text-[11px] font-normal text-slate-400 sm:text-xs">
                  / {activeMetrics.avgTargetCalories.toLocaleString()} kcal
                </span>
              </div>
              <div className="tabular-nums mt-1 leading-snug text-[11px] text-slate-400">
                <span
                  className={
                    activeMetrics.proteinAdherencePct >= 85
                      ? 'font-semibold text-[#2EE6A6]'
                      : 'font-semibold text-[#FFB020]'
                  }
                >
                  {activeMetrics.avgProteinG}g · {activeMetrics.proteinAdherencePct}%
                </span>{' '}
                protein · {activeMetrics.daysLogged}/7d logged
              </div>
            </div>

            {/* Tile 4: Activity & Recovery */}
            <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/85 p-3 sm:p-3.5">
              <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400 sm:text-[11px]">
                <Activity className="h-3.5 w-3.5 shrink-0 text-[#FFB020]" />
                <span className="truncate">Activity &amp; Recovery</span>
              </div>
              <div className="tabular-nums mt-1.5 text-base font-bold text-[#FFB020] sm:text-xl">
                +{activeMetrics.totalActiveCalories.toLocaleString()} kcal{' '}
                <span className="text-xs font-normal text-slate-400">
                  · {activeMetrics.workoutDays}d
                </span>
              </div>
              <div className="tabular-nums mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                {activeMetrics.avgSleepHours !== null || activeMetrics.avgRestingHr !== null ? (
                  <>
                    {activeMetrics.avgSleepHours !== null ? (
                      <span className="inline-flex items-center gap-1 text-[#38BDF8]">
                        <Moon className="h-3 w-3" />
                        {activeMetrics.avgSleepHours.toFixed(1)}h
                      </span>
                    ) : null}
                    {activeMetrics.avgRestingHr !== null ? (
                      <span className="inline-flex items-center gap-1 text-[#FF8A95]">
                        <HeartPulse className="h-3 w-3" />
                        {Math.round(activeMetrics.avgRestingHr)} bpm
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span>Supp adherence {activeMetrics.supplementAdherencePct}%</span>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {/* Adaptive Recommendation Bar */}
        {activeRecommendation ? (
          <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-white/10 bg-[#0F131C]/90 p-3.5 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {deltaBadge ? (
                  <span
                    className={`tabular-nums inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ${deltaBadge.className}`}
                  >
                    {deltaBadge.icon}
                    <span>{deltaBadge.label}</span>
                  </span>
                ) : null}

                <span className="tabular-nums text-xs font-semibold text-white">
                  Current {formatAdj(activeRecommendation.currentCalorieAdjustment)} kcal → Suggested{' '}
                  <span
                    className={
                      activeRecommendation.deltaKcal > 0
                        ? 'text-[#38BDF8]'
                        : activeRecommendation.deltaKcal < 0
                          ? 'text-[#FFB020]'
                          : 'text-[#2EE6A6]'
                    }
                  >
                    {formatAdj(activeRecommendation.suggestedCalorieAdjustment)} kcal
                  </span>
                </span>
              </div>

              <p className="break-words text-xs text-slate-400">
                {REASON_LABELS[activeRecommendation.reasonCode]}
              </p>

              {!report ? (
                <p className="break-words text-[11px] text-[#38BDF8]">
                  {activeRecommendation.canApply
                    ? 'Generate the AI Coach report above to unlock 1-click Apply Target for this calorie adjustment.'
                    : 'Click Generate AI Coach above for a personalized weekly review and action plan.'}
                </p>
              ) : null}
            </div>

            <div className="w-full shrink-0 sm:w-auto">
              {report && report.appliedAt ? (
                <span className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-2xl border border-[#2EE6A6]/40 bg-[#2EE6A6]/15 px-4 py-2 text-xs font-bold text-[#2EE6A6] sm:w-auto">
                  <Check className="h-4 w-4" />
                  Applied ✓
                </span>
              ) : report && report.recommendation.canApply ? (
                <button
                  type="button"
                  onClick={() => void handleApply()}
                  disabled={applying || generating}
                  className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#2EE6A6] px-4 py-2 text-xs font-bold text-[#081016] transition hover:brightness-110 active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 sm:w-auto"
                >
                  {applying ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Applying…</span>
                    </>
                  ) : (
                    <>
                      {activeRecommendation.deltaKcal < 0 ? (
                        <TrendingDown className="h-4 w-4" />
                      ) : (
                        <TrendingUp className="h-4 w-4" />
                      )}
                      <span>Apply Target</span>
                    </>
                  )}
                </button>
              ) : report ? (
                <span className="inline-flex min-h-[38px] items-center rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-slate-300">
                  No Adjustment Needed
                </span>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* AI Narrative Card */}
        {report ? (
          <div className="min-w-0 space-y-4 break-words rounded-2xl border border-white/10 bg-gradient-to-br from-[#141720] via-[#0F131C] to-[#0B1218] p-3.5 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-3 sm:items-center sm:gap-3.5">
                <WeeklyScoreRing score={report.narrative.weeklyScore} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        report.narrative.source === 'GEMINI'
                          ? 'border-[#38BDF8]/40 bg-[#38BDF8]/15 text-[#38BDF8]'
                          : 'border-[#FFB020]/35 bg-[#FFB020]/12 text-[#FFB020]'
                      }`}
                    >
                      <Sparkles className="h-3 w-3" />
                      {report.narrative.source === 'GEMINI' ? 'GEMINI' : 'Smart Fallback'}
                    </span>
                    <span className="tabular-nums text-[11px] text-slate-400">
                      Generated {new Date(report.generatedAt).toLocaleDateString()}
                    </span>
                  </div>
                  <h3 className="mt-1 break-words text-sm font-bold text-white sm:text-base">
                    {report.narrative.headline}
                  </h3>
                </div>
              </div>
            </div>

            <p className="break-words text-xs leading-relaxed text-slate-300 sm:text-sm">
              {report.narrative.summary}
            </p>

            {/* 3 Scannable Columns */}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {/* Wins */}
              <div className="min-w-0 break-words rounded-2xl border border-[#2EE6A6]/25 bg-[#2EE6A6]/[0.06] p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#2EE6A6]">
                  <Trophy className="h-3.5 w-3.5 shrink-0" />
                  <span>Wins</span>
                </div>
                <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-200">
                  {report.narrative.wins.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#2EE6A6]" />
                      <span className="min-w-0 flex-1 break-words">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Bottlenecks */}
              <div className="min-w-0 break-words rounded-2xl border border-[#FFB020]/25 bg-[#FFB020]/[0.06] p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#FFB020]">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>Bottlenecks</span>
                </div>
                {report.narrative.bottlenecks.length > 0 ? (
                  <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-200">
                    {report.narrative.bottlenecks.map((item, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#FFB020]" />
                        <span className="min-w-0 flex-1 break-words">{item}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">
                    No major bottlenecks detected this week.
                  </p>
                )}
              </div>

              {/* Next Week Action Plan */}
              <div className="min-w-0 break-words rounded-2xl border border-[#38BDF8]/25 bg-[#38BDF8]/[0.06] p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[#38BDF8]">
                  <ListChecks className="h-3.5 w-3.5 shrink-0" />
                  <span>Next Week Action Plan</span>
                </div>
                <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-slate-200">
                  {report.narrative.actionPlan.map((item, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#38BDF8]" />
                      <span className="min-w-0 flex-1 break-words">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Adjustment Rationale */}
            <div className="min-w-0 break-words rounded-xl border border-white/10 bg-[#0A0C10]/70 px-3.5 py-2.5 text-xs text-slate-300">
              <span className="font-semibold text-white">Adjustment Rationale: </span>
              {report.narrative.adjustmentRationale}
            </div>
          </div>
        ) : null}
      </div>
    </BentoCard>
  );
}
