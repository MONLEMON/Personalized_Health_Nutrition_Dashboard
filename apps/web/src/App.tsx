import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import {
  createBodyMetricSchema,
  type GoalType,
  type SupplementConfig,
  type UpdateProfileSettingsInput,
} from '@health-dash/shared';
import {
  Activity,
  AlertCircle,
  Calendar,
  Database,
  LogOut,
  RefreshCw,
  Scale,
  Settings,
  Target,
  X,
} from 'lucide-react';
import {
  ActivitySupplementCard,
  AppleHealthSyncPill,
  AppleShortcutsCard,
  HeroStatusCard,
  MacroRingsCard,
  MobileBottomNav,
  MonthlyCalendarCard,
  ProfileSettingsModal,
  ProfileSummaryCard,
  QuickLogFab,
  QuickLogModal,
  SupplementManagerModal,
  TodayLogsCard,
  WeeklyCoachCard,
  type MobileTab,
  type QuickLogTab,
} from './components';
const BodyRecompChart = lazy(() =>
  import('./components/BodyRecompChart').then((mod) => ({
    default: mod.BodyRecompChart,
  })),
);
import type { TrendTimeframeDays } from './components/BodyRecompChart';
import { useAuth } from './contexts/AuthContext';
import { useDashboard } from './hooks/useDashboard';

function formatDisplayDate(isoDate: string): string {
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (Number.isNaN(date.getTime())) return isoDate;
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function getGoalBadgeStyles(goalType: GoalType): { label: string; className: string } {
  switch (goalType) {
    case 'CUT':
      return {
        label: 'Cut',
        className: 'border-[#2EE6A6]/25 bg-[#2EE6A6]/10 text-[#2EE6A6]',
      };
    case 'BULK':
      return {
        label: 'Bulk',
        className: 'border-[#38BDF8]/25 bg-[#38BDF8]/10 text-[#38BDF8]',
      };
    case 'MAINTAIN':
    default:
      return {
        label: 'Maintain',
        className: 'border-[#FFB020]/25 bg-[#FFB020]/10 text-[#FFB020]',
      };
  }
}

interface WeighInModalProps {
  isOpen: boolean;
  currentWeightKg: number;
  currentBodyFatPct: number | null;
  currentMuscleKg: number | null;
  isSubmitting: boolean;
  onClose: () => void;
  onSubmit: (input: {
    weightKg: number;
    bodyFatPct?: number | null;
    skeletalMuscleMassKg?: number | null;
    notes?: string | null;
  }) => Promise<void>;
}

function WeighInModal({
  isOpen,
  currentWeightKg,
  currentBodyFatPct,
  currentMuscleKg,
  isSubmitting,
  onClose,
  onSubmit,
}: WeighInModalProps) {
  const [weightKg, setWeightKg] = useState(String(currentWeightKg));
  const [bodyFatPct, setBodyFatPct] = useState(
    currentBodyFatPct !== null ? String(currentBodyFatPct) : '',
  );
  const [muscleKg, setMuscleKg] = useState(
    currentMuscleKg !== null ? String(currentMuscleKg) : '',
  );
  const [notes, setNotes] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setValidationError(null);
    const parsed = createBodyMetricSchema.safeParse({
      weightKg: Number(weightKg),
      bodyFatPct: bodyFatPct.trim() === '' ? null : Number(bodyFatPct),
      skeletalMuscleMassKg: muscleKg.trim() === '' ? null : Number(muscleKg),
      notes: notes.trim() === '' ? null : notes.trim(),
    });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? 'Invalid body metric values');
      return;
    }
    try {
      await onSubmit(parsed.data);
      onClose();
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Unable to save weigh-in');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-md sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Log Body Weigh-In"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <div className="animate-sheet-up relative max-h-[90dvh] w-full overflow-x-hidden overflow-y-auto rounded-t-3xl rounded-b-none border-t border-x border-white/10 bg-[#141720]/98 px-4 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_-24px_64px_-12px_rgba(0,0,0,0.95)] backdrop-blur-2xl sm:max-w-md sm:rounded-3xl sm:border sm:p-6 sm:shadow-2xl">
        {/* iOS-style drag handle */}
        <div
          aria-hidden="true"
          className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-white/20 sm:hidden"
        />

        <div className="flex min-w-0 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#38BDF8]/15 text-[#38BDF8]">
              <Scale className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold text-white">Log Body Composition</h3>
              <p className="truncate text-xs text-slate-400">Updates BMR &amp; 7-day moving average</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            <label className="block min-w-0">
              <span className="block truncate text-[11px] font-medium text-slate-300 sm:text-xs">
                Weight (kg)*
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                required
                value={weightKg}
                onChange={(e) => setWeightKg(e.target.value)}
                className="mt-1.5 min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-[#0A0C10] px-2.5 py-2 text-base tabular-nums text-white outline-none focus:border-[#38BDF8] sm:px-3 sm:text-sm"
              />
            </label>
            <label className="block min-w-0">
              <span className="block truncate text-[11px] font-medium text-slate-300 sm:text-xs">
                Body Fat %
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={bodyFatPct}
                onChange={(e) => setBodyFatPct(e.target.value)}
                placeholder="16.5"
                className="mt-1.5 min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-[#0A0C10] px-2.5 py-2 text-base tabular-nums text-white outline-none focus:border-[#FFB020] sm:px-3 sm:text-sm"
              />
            </label>
            <label className="block min-w-0">
              <span className="block truncate text-[11px] font-medium text-slate-300 sm:text-xs">
                Muscle (kg)
              </span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                value={muscleKg}
                onChange={(e) => setMuscleKg(e.target.value)}
                placeholder="35.6"
                className="mt-1.5 min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-[#0A0C10] px-2.5 py-2 text-base tabular-nums text-white outline-none focus:border-[#2EE6A6] sm:px-3 sm:text-sm"
              />
            </label>
          </div>

          <label className="block min-w-0">
            <span className="text-xs font-medium text-slate-300">Notes</span>
            <input
              type="text"
              maxLength={300}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Morning fasted check-in"
              className="mt-1.5 min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-[#0A0C10] px-3 py-2 text-base text-white outline-none focus:border-white/30 sm:text-sm"
            />
          </label>

          {validationError ? (
            <div className="rounded-xl border border-[#FF5C6C]/30 bg-[#FF5C6C]/10 px-3 py-2 text-xs text-[#FF5C6C]">
              {validationError}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] flex-1 rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/5 sm:flex-none sm:text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="min-h-[44px] flex-1 rounded-xl bg-[#2EE6A6] px-4 py-2 text-sm font-semibold text-[#0A0C10] transition hover:brightness-110 disabled:opacity-50 sm:flex-none sm:text-xs"
            >
              {isSubmitting ? 'Saving…' : 'Save Weigh-In'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function App() {
  const { user, me, refreshMe, signOut } = useAuth();
  const displayEmail = user?.email ?? me?.email ?? null;

  const {
    dashboard,
    trends,
    syncStatus,
    trendDays,
    setTrendDays,
    loading,
    error,
    clearError,
    isDemoFallback,
    togglingSupplementKey,
    submittingLog,
    refresh,
    toggleSupplement,
    logMeal,
    logMealsBatch,
    removeMeal,
    logWorkout,
    removeWorkout,
    logBodyMetric,
    saveSupplementStack,
    saveProfileSettings,
  } = useDashboard();

  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [quickLogTab, setQuickLogTab] = useState<QuickLogTab>('ai');
  const [weighInOpen, setWeighInOpen] = useState(false);
  const [shortcutsModalOpen, setShortcutsModalOpen] = useState(false);
  const [supplementManagerOpen, setSupplementManagerOpen] = useState(false);
  const [profileSettingsOpen, setProfileSettingsOpen] = useState(false);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [mobileTab, setMobileTab] = useState<MobileTab>('dashboard');

  const bumpCalendar = () => setCalendarRefreshKey((prev) => prev + 1);

  useEffect(() => {
    if (!shortcutsModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShortcutsModalOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcutsModalOpen]);

  const openQuickLog = (tab: QuickLogTab) => {
    setQuickLogTab(tab);
    setQuickLogOpen(true);
  };

  const handleSelectMobileTab = (tab: MobileTab) => {
    setMobileTab(tab);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSyncPillClick = () => {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches) {
      setShortcutsModalOpen(true);
      return;
    }
    setMobileTab('profile');
    window.setTimeout(() => {
      document
        .getElementById('apple-shortcuts-integration')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  };

  if (!dashboard && loading) {
    return (
      <div className="min-h-screen overflow-x-clip bg-[#0A0C10] pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)] text-white md:pb-12">
        <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-8 lg:px-8">
          <div className="flex items-center justify-between pb-6">
            <div className="h-8 w-44 animate-pulse rounded-xl bg-white/10" />
            <div className="h-8 w-36 animate-pulse rounded-full bg-white/10 sm:w-56" />
          </div>
          <div className="h-56 animate-pulse rounded-3xl border border-white/5 bg-[#141720]" />
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-12">
            <div className="h-80 animate-pulse rounded-3xl border border-white/5 bg-[#141720] md:col-span-2 lg:col-span-7" />
            <div className="h-80 animate-pulse rounded-3xl border border-white/5 bg-[#141720] md:col-span-1 lg:col-span-5" />
            <div className="h-96 animate-pulse rounded-3xl border border-white/5 bg-[#141720] md:col-span-2 lg:col-span-8" />
            <div className="h-96 animate-pulse rounded-3xl border border-white/5 bg-[#141720] md:col-span-1 lg:col-span-4" />
          </div>
        </div>
      </div>
    );
  }

  if (!dashboard) {
    return null;
  }

  const goalBadge = getGoalBadgeStyles(dashboard.goal.goalType);
  const calAdjText =
    dashboard.goal.calorieAdjustment > 0
      ? `+${dashboard.goal.calorieAdjustment}`
      : `${dashboard.goal.calorieAdjustment}`;

  const storageStatus = isDemoFallback
    ? {
        label: 'Offline Demo',
        dotClass: 'bg-[#FFB020]',
        pillClass: 'border-[#FFB020]/25 bg-[#FFB020]/10 text-[#FFB020]',
      }
    : dashboard.storageMode === 'postgres'
      ? {
          label: 'PostgreSQL',
          dotClass: 'bg-[#2EE6A6]',
          pillClass: 'border-[#2EE6A6]/25 bg-[#2EE6A6]/10 text-[#2EE6A6]',
        }
      : {
          label: 'In-Memory',
          dotClass: 'bg-[#38BDF8]',
          pillClass: 'border-[#38BDF8]/25 bg-[#38BDF8]/10 text-[#38BDF8]',
        };

  return (
    <div className="min-h-screen overflow-x-clip bg-[#0A0C10] pb-[calc(6.5rem+env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)] text-white md:pb-12">
      {/* Ambient top glow */}
      <div className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,rgba(46,230,166,0.07),transparent_65%)]" />

      <div className="relative mx-auto max-w-7xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
        {/* Top Header */}
        <header className="mb-4 flex min-w-0 flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-center justify-between gap-2 sm:gap-3">
            <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#2EE6A6]/30 bg-gradient-to-br from-[#2EE6A6]/20 to-[#38BDF8]/15 shadow-[0_0_24px_rgba(46,230,166,0.18)]">
                <Activity className="h-5 w-5 text-[#2EE6A6]" />
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
                  <h1 className="text-lg font-bold tracking-tight text-white sm:text-xl">
                    VitalPulse
                  </h1>
                  <span className="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-slate-400 sm:px-2 sm:text-[10px]">
                    Biometric OS
                  </span>
                </div>
                <p className="hidden text-xs text-slate-400 sm:block">
                  Personalized Energy Balance, Macros &amp; Body Recomposition
                </p>
              </div>
            </div>

            {/* Compact Live Dot on Mobile Header */}
            <div
              className={`inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] font-medium sm:hidden ${storageStatus.pillClass}`}
            >
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${storageStatus.dotClass}`} />
              <span className="truncate">{storageStatus.label}</span>
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:gap-2">
            {/* Formatted Date Pill */}
            <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-[#141720] px-2.5 py-1.5 text-[11px] font-medium text-slate-300 sm:px-3 sm:text-xs">
              <Calendar className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="truncate">{formatDisplayDate(dashboard.date)}</span>
            </div>

            {/* Active Goal Badge (clickable to open Profile & Goal Settings) */}
            <button
              type="button"
              onClick={() => setProfileSettingsOpen(true)}
              title="Edit Profile & Goal Settings"
              className={`inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-semibold transition hover:brightness-110 active:scale-[0.98] sm:px-3 sm:text-xs ${goalBadge.className}`}
            >
              <Target className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">
                {goalBadge.label} · {calAdjText} kcal
              </span>
            </button>

            {/* Apple Health Sync Pill (Mobile + Desktop) */}
            <AppleHealthSyncPill syncStatus={syncStatus} onClick={handleSyncPillClick} className="max-w-full" />

            {/* Desktop Settings Button */}
            <button
              type="button"
              onClick={() => setProfileSettingsOpen(true)}
              aria-label="Open Profile and Goal Settings"
              title="Profile & Goal Settings"
              className="hidden cursor-pointer items-center gap-1.5 rounded-full border border-white/10 bg-[#141720] px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:border-white/20 hover:text-white md:inline-flex"
            >
              <Settings className="h-3.5 w-3.5 text-[#38BDF8]" />
              <span>Settings</span>
            </button>

            {/* Storage Mode / Live Status Indicator (Desktop/Tablet) */}
            <div
              className={`hidden items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium sm:inline-flex ${storageStatus.pillClass}`}
            >
              <Database className="h-3.5 w-3.5 opacity-80" />
              <span className={`h-1.5 w-1.5 rounded-full ${storageStatus.dotClass}`} />
              <span>{storageStatus.label}</span>
              {isDemoFallback ? (
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="ml-1 inline-flex items-center gap-1 rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white transition hover:bg-white/20"
                  title="Retry live API connection"
                >
                  <RefreshCw className={`h-2.5 w-2.5 ${loading ? 'animate-spin' : ''}`} />
                  Retry
                </button>
              ) : null}
            </div>

            {/* Desktop Authenticated User Pill & Sign Out */}
            <div className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-[#141720] py-1 pr-1 pl-3 text-xs text-slate-300 md:inline-flex">
              {displayEmail ? (
                <span className="max-w-[160px] truncate text-slate-300" title={displayEmail}>
                  {displayEmail}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => void signOut()}
                className="inline-flex min-h-[30px] cursor-pointer items-center gap-1.5 rounded-full bg-white/[0.06] px-2.5 py-1 text-xs font-semibold text-slate-200 transition hover:bg-[#FF5C6C]/15 hover:text-[#FF8A95]"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </header>

        {/* Non-blocking Error Banner */}
        {error ? (
          <div className="mb-4 flex min-w-0 items-center justify-between gap-3 rounded-2xl border border-[#FF5C6C]/30 bg-[#FF5C6C]/10 px-4 py-3 text-xs text-[#FF8A95] sm:mb-5">
            <div className="flex min-w-0 items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-[#FF5C6C]" />
              <span className="min-w-0 break-words">{error}</span>
            </div>
            <button
              type="button"
              onClick={clearError}
              className="flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-lg p-1 text-[#FF8A95] transition hover:bg-white/10 hover:text-white"
              aria-label="Dismiss error"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        {/* Full-Width Hero Readiness Card (Always at top on mobile Dashboard & Tablet/Desktop) */}
        <div className={`mb-4 min-w-0 sm:mb-5 ${mobileTab === 'dashboard' ? 'block' : 'hidden md:block'}`}>
          <HeroStatusCard
            readiness={dashboard.readiness}
            energy={dashboard.energy}
            goal={dashboard.goal}
            latestMetric={dashboard.latestMetric}
            profileName={dashboard.profile.name}
            weeklyBudget={dashboard.weeklyBudget}
          />
        </div>

        {/* Mobile-First Progressive Bento Grid (1 col mobile -> 2 col tablet -> 12 col desktop) */}
        <main className="grid grid-cols-1 gap-4 md:grid-cols-2 md:gap-5 lg:grid-cols-12">
          <div
            className={`min-w-0 md:col-span-2 lg:col-span-7 ${
              mobileTab === 'dashboard' ? 'block' : 'hidden md:block'
            }`}
          >
            <MacroRingsCard energy={dashboard.energy} macros={dashboard.macros} />
          </div>

          <div
            className={`min-w-0 md:col-span-1 lg:col-span-5 ${
              mobileTab === 'dashboard' ? 'block' : 'hidden md:block'
            }`}
          >
            <ActivitySupplementCard
              workouts={dashboard.workouts}
              supplements={dashboard.supplements}
              activeCalories={dashboard.energy.activeCalories}
              onToggleSupplement={async (key) => {
                await toggleSupplement(key);
                bumpCalendar();
              }}
              togglingKey={togglingSupplementKey}
              onDeleteWorkout={async (id) => {
                await removeWorkout(id);
                bumpCalendar();
              }}
              onAddWorkoutClick={() => openQuickLog('workout')}
              onManageSupplementsClick={() => setSupplementManagerOpen(true)}
            />
          </div>

          <div
            className={`min-w-0 md:col-span-2 lg:col-span-12 ${
              mobileTab === 'trends' ? 'block' : 'hidden md:block'
            }`}
          >
            <WeeklyCoachCard
              todayDate={dashboard.date}
              refreshTrigger={calendarRefreshKey}
              isDemoFallback={isDemoFallback}
              fallbackGoal={dashboard.goal}
              fallbackEnergy={dashboard.energy}
              onTargetApplied={async () => {
                if (!isDemoFallback) {
                  await refresh();
                }
                bumpCalendar();
              }}
            />
          </div>

          <div
            className={`min-w-0 md:col-span-2 lg:col-span-8 ${
              mobileTab === 'trends' ? 'block' : 'hidden md:block'
            }`}
          >
            <Suspense
              fallback={
                <div className="h-[380px] animate-pulse rounded-3xl border border-white/5 bg-[#141720]" />
              }
            >
              <BodyRecompChart
                trends={trends}
                days={trendDays}
                onDaysChange={setTrendDays}
                loading={loading}
                onLogMetricClick={() => setWeighInOpen(true)}
              />
            </Suspense>
          </div>

          <div
            className={`min-w-0 md:col-span-1 lg:col-span-4 ${
              mobileTab === 'dashboard' ? 'block' : 'hidden md:block'
            }`}
          >
            <TodayLogsCard
              meals={dashboard.meals}
              onDeleteMeal={async (id) => {
                await removeMeal(id);
                bumpCalendar();
              }}
              onAddMealClick={() => openQuickLog('ai')}
            />
          </div>

          <div
            className={`min-w-0 md:col-span-2 lg:col-span-12 ${
              mobileTab === 'calendar' ? 'block' : 'hidden md:block'
            }`}
          >
            <MonthlyCalendarCard
              todayDate={dashboard.date}
              refreshTrigger={calendarRefreshKey}
              isDemoFallback={isDemoFallback}
              fallbackDashboard={dashboard}
            />
          </div>

          {/* Mobile Trends Snapshot Footer Card */}
          {mobileTab === 'trends' ? (
            <div className="min-w-0 md:hidden">
              <div className="rounded-3xl border border-white/5 bg-[#141720] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.45)]">
                <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      Latest Body Snapshot
                    </div>
                    <div className="tabular-nums mt-1 text-lg font-bold text-white">
                      {dashboard.latestMetric.weightKg.toFixed(1)} kg
                      {dashboard.latestMetric.bodyFatPct !== null ? (
                        <span className="ml-2 text-sm font-medium text-[#FFB020]">
                          {dashboard.latestMetric.bodyFatPct.toFixed(1)}% BF
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setWeighInOpen(true)}
                    className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-2xl bg-[#2EE6A6] px-4 py-2 text-xs font-bold text-[#081016] transition hover:brightness-110 active:scale-95"
                  >
                    <Scale className="h-4 w-4" />
                    Weigh-In
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {/* Mobile Profile View */}
          {mobileTab === 'profile' ? (
            <div className="min-w-0 md:hidden">
              <ProfileSummaryCard
                profile={dashboard.profile}
                goal={dashboard.goal}
                energy={dashboard.energy}
                latestMetric={dashboard.latestMetric}
                storageMode={dashboard.storageMode}
                isDemoFallback={isDemoFallback}
                loading={loading}
                onLogMetricClick={() => setWeighInOpen(true)}
                onRefresh={() => {
                  void refresh().then(() => bumpCalendar());
                }}
                onEditProfileClick={() => setProfileSettingsOpen(true)}
                onManageSupplementsClick={() => setSupplementManagerOpen(true)}
                syncStatus={syncStatus}
                recordedDate={dashboard.date}
                onSyncSuccess={async () => {
                  await refresh();
                  bumpCalendar();
                }}
                userEmail={displayEmail}
                webhookKeyStatus={me?.webhookKey}
                onKeyGenerated={async () => {
                  await refreshMe();
                }}
                onSignOut={signOut}
              />
            </div>
          ) : null}
        </main>
      </div>

      {/* Desktop Floating Quick-Log Trigger */}
      <QuickLogFab
        onOpenMealModal={() => openQuickLog('meal')}
        onOpenWorkoutModal={() => openQuickLog('workout')}
      />

      {/* Mobile Native Bottom Tab Bar */}
      <MobileBottomNav
        activeTab={mobileTab}
        onSelectTab={handleSelectMobileTab}
        onOpenQuickLog={() => openQuickLog('ai')}
      />

      <QuickLogModal
        isOpen={quickLogOpen}
        initialTab={quickLogTab}
        onClose={() => setQuickLogOpen(false)}
        onSubmitMeal={async (input) => {
          await logMeal(input);
          bumpCalendar();
        }}
        onSubmitMealsBatch={async (input) => {
          await logMealsBatch(input);
          bumpCalendar();
        }}
        onSubmitWorkout={async (input) => {
          await logWorkout(input);
          bumpCalendar();
        }}
        isSubmitting={submittingLog}
      />

      {weighInOpen ? (
        <WeighInModal
          isOpen={weighInOpen}
          currentWeightKg={dashboard.latestMetric.weightKg}
          currentBodyFatPct={dashboard.latestMetric.bodyFatPct}
          currentMuscleKg={dashboard.latestMetric.skeletalMuscleMassKg}
          isSubmitting={submittingLog}
          onClose={() => setWeighInOpen(false)}
          onSubmit={async (input) => {
            await logBodyMetric(input);
            bumpCalendar();
          }}
        />
      ) : null}

      <SupplementManagerModal
        isOpen={supplementManagerOpen}
        supplements={dashboard.profile.supplementStack}
        isSubmitting={submittingLog}
        onClose={() => setSupplementManagerOpen(false)}
        onSave={async (supplements: SupplementConfig[]) => {
          await saveSupplementStack(supplements);
          bumpCalendar();
        }}
      />

      <ProfileSettingsModal
        isOpen={profileSettingsOpen}
        profile={dashboard.profile}
        goal={dashboard.goal}
        latestMetric={dashboard.latestMetric}
        activeCalories={dashboard.energy.activeCalories}
        isSubmitting={submittingLog}
        onClose={() => setProfileSettingsOpen(false)}
        onSave={async (input: UpdateProfileSettingsInput) => {
          await saveProfileSettings(input);
          bumpCalendar();
        }}
      />

      {shortcutsModalOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-md sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Apple Shortcuts Integration"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShortcutsModalOpen(false);
            }
          }}
        >
          <div className="animate-sheet-up relative max-h-[92dvh] w-full overflow-x-hidden overflow-y-auto rounded-t-3xl sm:max-w-2xl sm:rounded-3xl">
            <AppleShortcutsCard
              syncStatus={syncStatus}
              webhookKeyStatus={me?.webhookKey}
              onKeyGenerated={async () => {
                await refreshMe();
              }}
              recordedDate={dashboard.date}
              onSyncSuccess={async () => {
                await refresh();
                bumpCalendar();
              }}
              onClose={() => setShortcutsModalOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default App;
