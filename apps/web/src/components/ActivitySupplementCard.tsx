import type {
  SupplementStatusDTO,
  WorkoutCategory,
  WorkoutIntensity,
  WorkoutLogDTO,
} from '@health-dash/shared';
import {
  Activity,
  Check,
  Dumbbell,
  Flame,
  Footprints,
  Loader2,
  Pill,
  Plus,
  Sparkles,
  Trash2,
  Trophy,
  Zap,
} from 'lucide-react';
import { BentoCard } from './BentoCard';

export interface ActivitySupplementCardProps {
  workouts: WorkoutLogDTO[];
  supplements: SupplementStatusDTO[];
  activeCalories: number;
  onToggleSupplement: (supplementKey: string) => void | Promise<void>;
  togglingKey?: string | null;
  onDeleteWorkout?: (id: string) => void | Promise<void>;
  onAddWorkoutClick?: () => void;
}

const CATEGORY_ICONS: Record<WorkoutCategory, typeof Dumbbell> = {
  strength: Dumbbell,
  cardio: Footprints,
  hiit: Flame,
  mobility: Sparkles,
  sport: Trophy,
};

const INTENSITY_STYLES: Record<WorkoutIntensity, string> = {
  low: 'border-[#38BDF8]/25 bg-[#38BDF8]/10 text-[#38BDF8]',
  moderate: 'border-[#FFB020]/25 bg-[#FFB020]/10 text-[#FFB020]',
  high: 'border-[#FF5C6C]/25 bg-[#FF5C6C]/10 text-[#FF5C6C]',
};

export function ActivitySupplementCard({
  workouts,
  supplements,
  activeCalories,
  onToggleSupplement,
  togglingKey = null,
  onDeleteWorkout,
  onAddWorkoutClick,
}: ActivitySupplementCardProps) {
  const takenCount = supplements.filter((s) => s.taken).length;

  return (
    <BentoCard
      title="Activity & Supplements"
      subtitle="Workouts boost Dynamic TDEE immediately"
      icon={<Activity className="h-4 w-4 text-[#FFB020]" />}
      headerRight={
        <span className="tabular-nums inline-flex items-center gap-1 rounded-full border border-[#FFB020]/25 bg-[#FFB020]/10 px-2.5 py-1 text-xs font-semibold text-[#FFB020]">
          <Zap className="h-3 w-3" />+{activeCalories.toLocaleString()} kcal
        </span>
      }
      accentGlow="amber"
      className="h-full"
    >
      <div className="flex h-full flex-col gap-5">
        {/* Today's Workouts Section */}
        <div>
          <div className="mb-2.5 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Today&apos;s Workouts ({workouts.length})
            </h3>
            {onAddWorkoutClick && (
              <button
                type="button"
                onClick={onAddWorkoutClick}
                className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:border-white/20 hover:bg-white/[0.08]"
              >
                <Plus className="h-3 w-3" />
                Add
              </button>
            )}
          </div>

          {workouts.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#0F131C]/50 px-4 py-5 text-center">
              <p className="text-xs text-slate-400">No workouts logged today yet.</p>
              {onAddWorkoutClick && (
                <button
                  type="button"
                  onClick={onAddWorkoutClick}
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-white/15"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Log Workout
                </button>
              )}
            </div>
          ) : (
            <ul className="space-y-2">
              {workouts.map((workout) => {
                const Icon = CATEGORY_ICONS[workout.category] ?? Activity;
                return (
                  <li
                    key={workout.id}
                    className="group flex items-center justify-between gap-2.5 rounded-2xl border border-white/5 bg-[#0F131C]/80 px-3.5 py-2.5 transition hover:border-white/10"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-200">
                        <Icon className="h-4 w-4 text-[#FFB020]" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">
                          {workout.activityName}
                        </p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                          <span className="tabular-nums">{workout.durationMin} min</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={`rounded-full border px-1.5 py-px text-[10px] font-medium capitalize ${INTENSITY_STYLES[workout.intensity]}`}
                          >
                            {workout.intensity}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <span className="tabular-nums rounded-full border border-[#2EE6A6]/20 bg-[#2EE6A6]/10 px-2 py-0.5 text-[11px] font-semibold text-[#2EE6A6]">
                        +{workout.activeCalories} kcal
                      </span>
                      {onDeleteWorkout && (
                        <button
                          type="button"
                          onClick={() => onDeleteWorkout(workout.id)}
                          aria-label={`Delete ${workout.activityName}`}
                          className="rounded-lg p-1 text-slate-500 transition hover:bg-[#FF5C6C]/15 hover:text-[#FF5C6C]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Supplement Pill Tracker */}
        <div className="border-t border-white/5 pt-4">
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Pill className="h-3.5 w-3.5 text-[#2EE6A6]" />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Supplement Stack
              </h3>
            </div>
            <span className="tabular-nums text-xs font-medium text-slate-300">
              {takenCount} / {supplements.length} taken
            </span>
          </div>

          <div className="flex flex-wrap gap-2">
            {supplements.map((supp) => {
              const isToggling = togglingKey === supp.key;
              return (
                <button
                  key={supp.key}
                  type="button"
                  disabled={isToggling}
                  onClick={() => onToggleSupplement(supp.key)}
                  aria-pressed={supp.taken}
                  className={`group inline-flex items-center gap-2 rounded-2xl border px-3 py-2 text-left transition-all duration-200 disabled:cursor-wait disabled:opacity-70 ${
                    supp.taken
                      ? 'border-[#2EE6A6]/45 bg-[#2EE6A6]/12 text-white shadow-[0_0_20px_-6px_rgba(46,230,166,0.55)]'
                      : 'border-white/10 bg-[#0F131C]/75 text-slate-300 hover:border-white/20 hover:bg-white/[0.05]'
                  }`}
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
                      supp.taken
                        ? 'border-[#2EE6A6] bg-[#2EE6A6] text-[#081016]'
                        : 'border-white/20 bg-white/[0.03] text-transparent group-hover:border-white/35'
                    }`}
                  >
                    {isToggling ? (
                      <Loader2 className="h-3 w-3 animate-spin text-current" />
                    ) : (
                      <Check className="h-3 w-3 stroke-[2.75]" />
                    )}
                  </span>

                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold leading-tight">
                      {supp.name}
                    </span>
                    <span className="block truncate text-[10px] text-slate-400">
                      {supp.dosage} · {supp.timing}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </BentoCard>
  );
}
