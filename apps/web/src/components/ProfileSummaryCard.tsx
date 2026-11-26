import { useState } from 'react';
import type {
  BodyMetricDTO,
  EnergySummary,
  SyncStatusDTO,
  UserGoalDTO,
  UserProfileDTO,
  WebhookKeyStatusDTO,
} from '@health-dash/shared';
import {
  Activity,
  Database,
  Flame,
  LogOut,
  RefreshCw,
  Scale,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  User,
} from 'lucide-react';
import { AppleShortcutsCard } from './AppleShortcutsCard';
import { BentoCard } from './BentoCard';

export interface ProfileSummaryCardProps {
  profile: UserProfileDTO;
  goal: UserGoalDTO;
  energy: EnergySummary;
  latestMetric: BodyMetricDTO;
  storageMode: 'postgres' | 'memory';
  isDemoFallback: boolean;
  loading?: boolean;
  onLogMetricClick: () => void;
  onRefresh: () => void;
  onEditProfileClick?: () => void;
  onManageSupplementsClick?: () => void;
  syncStatus?: SyncStatusDTO;
  recordedDate?: string;
  onSyncSuccess?: () => Promise<void> | void;
  userEmail?: string | null;
  webhookKeyStatus?: WebhookKeyStatusDTO;
  onKeyGenerated?: () => Promise<void> | void;
  onSignOut?: () => Promise<void> | void;
}

export function ProfileSummaryCard({
  profile,
  goal,
  energy,
  latestMetric,
  storageMode,
  isDemoFallback,
  loading = false,
  onLogMetricClick,
  onRefresh,
  onEditProfileClick,
  onManageSupplementsClick,
  syncStatus,
  recordedDate,
  onSyncSuccess,
  userEmail,
  webhookKeyStatus,
  onKeyGenerated,
  onSignOut,
}: ProfileSummaryCardProps) {
  const [signingOut, setSigningOut] = useState(false);

  const formulaLabel =
    energy.bmrFormula === 'katch_mcardle' ? 'Katch-McArdle (LBM)' : 'Mifflin-St Jeor';
  const calAdjText =
    goal.calorieAdjustment > 0 ? `+${goal.calorieAdjustment}` : `${goal.calorieAdjustment}`;
  const storageLabel = isDemoFallback
    ? 'Offline Demo'
    : storageMode === 'postgres'
      ? 'PostgreSQL Live'
      : 'In-Memory Store';

  const handleSignOutClick = async () => {
    if (!onSignOut || signingOut) return;
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="min-w-0 space-y-4">
      <BentoCard
        title="Biometric Profile"
        subtitle="Body stats, goal rules & metabolic engine"
        icon={<User className="h-4 w-4 text-[#2EE6A6]" />}
        headerRight={
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-slate-300">
            <Database className="h-3 w-3 shrink-0 text-[#2EE6A6]" />
            <span className="truncate">{storageLabel}</span>
          </span>
        }
        accentGlow="mint"
      >
        <div className="min-w-0 space-y-4">
          {/* Identity Banner */}
          <div className="flex min-w-0 items-center gap-3.5 rounded-2xl border border-white/5 bg-[#0F131C]/80 p-3.5">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#2EE6A6]/30 bg-[#2EE6A6]/12 text-lg font-bold text-[#2EE6A6]">
              {profile.name.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold text-white">{profile.name}</div>
              {userEmail ? (
                <div className="truncate text-[11px] text-[#2EE6A6]/90">{userEmail}</div>
              ) : null}
              <div className="mt-0.5 break-words text-xs text-slate-400">
                {profile.age} yrs · {profile.heightCm} cm ·{' '}
                <span className="capitalize">{profile.sex}</span> ·{' '}
                <span className="tabular-nums">
                  ×{profile.baselineActivityMultiplier}{' '}
                  {profile.tdeeMode === 'FIXED_STATIC'
                    ? 'Static TDEE'
                    : profile.tdeeMode === 'APPLE_HEALTH_DYNAMIC'
                      ? 'Watch Base'
                      : 'NEAT'}
                </span>
              </div>
            </div>
          </div>

          {/* Active Goal & Macro Targets */}
          <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
            <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/75 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                <Target className="h-3.5 w-3.5 shrink-0 text-[#2EE6A6]" />
                <span className="truncate">Active Goal</span>
              </div>
              <div className="tabular-nums mt-1.5 truncate text-sm font-bold text-white">
                {goal.goalType} ({calAdjText} kcal)
              </div>
              <div className="tabular-nums mt-0.5 truncate text-[11px] text-slate-400">
                Protein {goal.proteinPerKg} g/kg · Fat {Math.round(goal.fatRatio * 100)}%
              </div>
            </div>

            <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/75 p-3">
              <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#38BDF8]" />
                <span className="truncate">Metabolic Engine</span>
              </div>
              <div className="tabular-nums mt-1.5 truncate text-sm font-bold text-white">
                BMR {energy.bmr.toLocaleString()} kcal
              </div>
              <div className="mt-0.5 truncate text-[11px] text-slate-400">{formulaLabel}</div>
            </div>
          </div>

          {/* Latest Body Metrics Snapshot */}
          <div className="grid grid-cols-3 gap-2">
            <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/75 p-2.5 text-center sm:p-3">
              <div className="truncate text-[11px] text-slate-400">Weight</div>
              <div className="tabular-nums mt-1 text-base font-bold text-white">
                {latestMetric.weightKg.toFixed(1)}
                <span className="ml-0.5 text-[11px] font-normal text-slate-400">kg</span>
              </div>
            </div>
            <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/75 p-2.5 text-center sm:p-3">
              <div className="truncate text-[11px] text-slate-400">Body Fat</div>
              <div className="tabular-nums mt-1 text-base font-bold text-[#FFB020]">
                {latestMetric.bodyFatPct !== null ? `${latestMetric.bodyFatPct.toFixed(1)}%` : '—'}
              </div>
            </div>
            <div className="min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/75 p-2.5 text-center sm:p-3">
              <div className="truncate text-[11px] text-slate-400">Muscle</div>
              <div className="tabular-nums mt-1 text-base font-bold text-[#2EE6A6]">
                {latestMetric.skeletalMuscleMassKg !== null
                  ? `${latestMetric.skeletalMuscleMassKg.toFixed(1)}`
                  : '—'}
                {latestMetric.skeletalMuscleMassKg !== null ? (
                  <span className="ml-0.5 text-[11px] font-normal text-slate-400">kg</span>
                ) : null}
              </div>
            </div>
          </div>

          {/* Energy Summary Strip */}
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/5 bg-[#0F131C]/75 px-3.5 py-2.5 text-xs">
            <div className="flex min-w-0 items-center gap-2 text-slate-300">
              <Flame className="h-4 w-4 shrink-0 text-[#FFB020]" />
              <span>
                {energy.tdeeMode === 'FIXED_STATIC' ? 'Static TDEE / Target' : 'Dynamic TDEE / Target'}
              </span>
            </div>
            <span className="tabular-nums font-semibold text-white">
              {energy.dynamicTdee.toLocaleString()} / {energy.targetCalories.toLocaleString()} kcal
            </span>
          </div>

          {/* Touch-friendly Action Buttons */}
          <div className="grid grid-cols-2 gap-2.5 pt-1">
            <button
              type="button"
              onClick={onLogMetricClick}
              className="inline-flex min-h-[44px] min-w-0 items-center justify-center gap-2 rounded-2xl bg-[#2EE6A6] px-3 py-2.5 text-xs font-bold text-[#081016] transition hover:brightness-110 active:scale-[0.98] sm:px-4"
            >
              <Scale className="h-4 w-4 shrink-0" />
              <span className="truncate">Log Weigh-In</span>
            </button>
            <button
              type="button"
              onClick={onRefresh}
              disabled={loading}
              className="inline-flex min-h-[44px] min-w-0 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs font-semibold text-slate-200 transition hover:bg-white/10 active:scale-[0.98] disabled:opacity-50 sm:px-4"
            >
              <RefreshCw className={`h-4 w-4 shrink-0 ${loading ? 'animate-spin' : ''}`} />
              <span className="truncate">Refresh Sync</span>
            </button>
          </div>

          {onEditProfileClick ? (
            <button
              type="button"
              onClick={onEditProfileClick}
              className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-[#38BDF8]/30 bg-[#38BDF8]/10 px-4 py-2.5 text-xs font-semibold text-[#38BDF8] transition hover:bg-[#38BDF8]/20 active:scale-[0.98]"
            >
              <Settings className="h-4 w-4 shrink-0" />
              <span>Edit Profile &amp; Goals</span>
            </button>
          ) : null}

          {onSignOut ? (
            <button
              type="button"
              onClick={() => void handleSignOutClick()}
              disabled={signingOut}
              className="inline-flex min-h-[44px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-white/10 bg-[#0A0C10]/80 px-4 py-2.5 text-xs font-semibold text-slate-300 transition hover:border-[#FF5C6C]/35 hover:bg-[#FF5C6C]/10 hover:text-[#FF8A95] active:scale-[0.98] disabled:opacity-50"
            >
              <LogOut className="h-4 w-4 shrink-0" />
              <span>{signingOut ? 'Signing Out…' : 'Sign Out'}</span>
            </button>
          ) : null}
        </div>
      </BentoCard>

      {onManageSupplementsClick ? (
        <button
          type="button"
          onClick={onManageSupplementsClick}
          className="flex min-h-[44px] w-full min-w-0 cursor-pointer flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-[#141720] px-4 py-3 text-xs text-slate-300 transition hover:border-[#2EE6A6]/35 hover:bg-white/[0.04]"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Activity className="h-4 w-4 shrink-0 text-[#38BDF8]" />
            <span>Active Supplement Stack</span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="tabular-nums font-semibold text-white">
              {profile.supplementStack.length} items
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-[#2EE6A6]/30 bg-[#2EE6A6]/12 px-2.5 py-0.5 text-[11px] font-semibold text-[#2EE6A6]">
              <SlidersHorizontal className="h-3 w-3" />
              Manage Stack
            </span>
          </div>
        </button>
      ) : (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/5 bg-[#141720] px-4 py-3 text-xs text-slate-400">
          <div className="flex min-w-0 items-center gap-2">
            <Activity className="h-4 w-4 shrink-0 text-[#38BDF8]" />
            <span>Active Supplement Stack</span>
          </div>
          <span className="tabular-nums font-semibold text-white">
            {profile.supplementStack.length} items configured
          </span>
        </div>
      )}

      {syncStatus && onSyncSuccess ? (
        <AppleShortcutsCard
          id="apple-shortcuts-integration"
          syncStatus={syncStatus}
          webhookKeyStatus={webhookKeyStatus}
          onKeyGenerated={onKeyGenerated}
          recordedDate={recordedDate}
          onSyncSuccess={onSyncSuccess}
        />
      ) : null}
    </div>
  );
}
