import type { MealType, NutritionLogDTO } from '@health-dash/shared';
import { Plus, Sparkles, Trash2, Utensils } from 'lucide-react';
import { BentoCard } from './BentoCard';

export interface TodayLogsCardProps {
  meals: NutritionLogDTO[];
  onDeleteMeal?: (id: string) => void | Promise<void>;
  onAddMealClick?: () => void;
}

const MEAL_TYPE_BADGE: Record<MealType, { label: string; classes: string }> = {
  breakfast: {
    label: 'Breakfast',
    classes: 'border-[#FFB020]/30 bg-[#FFB020]/10 text-[#FFB020]',
  },
  lunch: {
    label: 'Lunch',
    classes: 'border-[#2EE6A6]/30 bg-[#2EE6A6]/10 text-[#2EE6A6]',
  },
  dinner: {
    label: 'Dinner',
    classes: 'border-[#38BDF8]/30 bg-[#38BDF8]/10 text-[#38BDF8]',
  },
  snack: {
    label: 'Snack',
    classes: 'border-purple-400/30 bg-purple-400/10 text-purple-300',
  },
  supplement: {
    label: 'Supplement',
    classes: 'border-slate-400/30 bg-slate-400/10 text-slate-300',
  },
};

function formatTime(isoString: string): string {
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function TodayLogsCard({ meals, onDeleteMeal, onAddMealClick }: TodayLogsCardProps) {
  const totalCalories = meals.reduce((sum, item) => sum + item.calories, 0);

  return (
    <BentoCard
      title="Today's Nutrition Logs"
      subtitle={`${meals.length} ${meals.length === 1 ? 'entry' : 'entries'} · ${Math.round(totalCalories).toLocaleString()} kcal`}
      icon={<Utensils className="h-4 w-4 text-[#2EE6A6]" />}
      headerRight={
        onAddMealClick ? (
          <button
            type="button"
            onClick={onAddMealClick}
            className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white transition hover:border-[#2EE6A6]/40 hover:bg-[#2EE6A6]/10 hover:text-[#2EE6A6]"
          >
            <Plus className="h-3.5 w-3.5" />
            Log Meal
          </button>
        ) : undefined
      }
      accentGlow="mint"
      className="h-full"
    >
      {meals.length === 0 ? (
        <div className="flex h-full min-h-[190px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#0F131C]/50 px-5 py-8 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-400">
            <Utensils className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium text-slate-200">No meals logged today</p>
          <p className="mt-1 max-w-xs text-xs text-slate-400">
            Log your first meal or snack to update your remaining calories and macro rings.
          </p>
          {onAddMealClick && (
            <button
              type="button"
              onClick={onAddMealClick}
              className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#2EE6A6] px-4 py-2 text-xs font-semibold text-[#081016] transition hover:brightness-110"
            >
              <Plus className="h-3.5 w-3.5" />
              Add First Meal
            </button>
          )}
        </div>
      ) : (
        <ul className="max-h-[340px] space-y-2.5 overflow-y-auto pr-1">
          {meals.map((meal) => {
            const badge = MEAL_TYPE_BADGE[meal.mealType] ?? MEAL_TYPE_BADGE.snack;
            const timeLabel = formatTime(meal.loggedAt);

            return (
              <li
                key={meal.id}
                className="group rounded-2xl border border-white/5 bg-[#0F131C]/80 p-3.5 transition hover:border-white/10"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.classes}`}
                      >
                        {badge.label}
                      </span>
                      {(meal.source === 'AI_TEXT' || meal.source === 'AI_IMAGE') && (
                        <span
                          title={
                            meal.source === 'AI_IMAGE'
                              ? 'Logged with AI Photo Scan'
                              : 'Logged with AI Smart Log'
                          }
                          className="inline-flex items-center gap-1 rounded-full border border-[#38BDF8]/30 bg-gradient-to-r from-[#2EE6A6]/15 to-[#38BDF8]/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#38BDF8]"
                        >
                          <Sparkles className="h-2.5 w-2.5 text-[#2EE6A6]" />
                          AI
                        </span>
                      )}
                      {timeLabel && (
                        <span className="tabular-nums text-[11px] text-slate-500">
                          {timeLabel}
                        </span>
                      )}
                    </div>
                    <p className="mt-1.5 truncate text-sm font-medium text-white">
                      {meal.itemName}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <span className="tabular-nums text-sm font-bold text-white">
                      {Math.round(meal.calories)}{' '}
                      <span className="text-[11px] font-normal text-slate-400">kcal</span>
                    </span>
                    {onDeleteMeal && (
                      <button
                        type="button"
                        onClick={() => onDeleteMeal(meal.id)}
                        aria-label={`Delete ${meal.itemName}`}
                        className="rounded-lg p-1 text-slate-500 transition hover:bg-[#FF5C6C]/15 hover:text-[#FF5C6C]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {/* P / C / F Macro Pills */}
                <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="tabular-nums rounded-lg bg-[#2EE6A6]/10 px-2 py-0.5 text-[11px] font-medium text-[#2EE6A6]">
                    P {Math.round(meal.proteinG)}g
                  </span>
                  <span className="tabular-nums rounded-lg bg-[#38BDF8]/10 px-2 py-0.5 text-[11px] font-medium text-[#38BDF8]">
                    C {Math.round(meal.carbsG)}g
                  </span>
                  <span className="tabular-nums rounded-lg bg-[#FBBF24]/10 px-2 py-0.5 text-[11px] font-medium text-[#FBBF24]">
                    F {Math.round(meal.fatG)}g
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </BentoCard>
  );
}
