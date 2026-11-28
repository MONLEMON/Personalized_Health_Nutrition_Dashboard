import { useEffect, useRef, useState } from 'react';
import type {
  CopyYesterdayMealsResponse,
  MealType,
  NutritionLogDTO,
} from '@health-dash/shared';
import {
  BookmarkPlus,
  Check,
  Copy,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  Utensils,
} from 'lucide-react';
import { BentoCard } from './BentoCard';

export interface TodayLogsCardProps {
  meals: NutritionLogDTO[];
  onDeleteMeal?: (id: string) => void | Promise<void>;
  onEditMeal?: (meal: NutritionLogDTO) => void;
  onSaveAsFavorite?: (meal: NutritionLogDTO) => void | Promise<void>;
  onCopyYesterday?: () => Promise<CopyYesterdayMealsResponse | void>;
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

export function TodayLogsCard({
  meals,
  onDeleteMeal,
  onEditMeal,
  onSaveAsFavorite,
  onCopyYesterday,
  onAddMealClick,
}: TodayLogsCardProps) {
  const totalCalories = meals.reduce((sum, item) => sum + item.calories, 0);

  const [savingFavoriteId, setSavingFavoriteId] = useState<string | null>(null);
  const [savedFavoriteIds, setSavedFavoriteIds] = useState<Record<string, boolean>>({});
  const [copyingYesterday, setCopyingYesterday] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<{
    tone: 'mint' | 'amber' | 'coral';
    message: string;
  } | null>(null);

  const favoriteTimersRef = useRef<Record<string, number>>({});
  const copyFeedbackTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const favTimers = favoriteTimersRef.current;
    return () => {
      for (const timer of Object.values(favTimers)) {
        window.clearTimeout(timer);
      }
      if (copyFeedbackTimerRef.current !== null) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  const handleSaveFavorite = async (meal: NutritionLogDTO) => {
    if (!onSaveAsFavorite || savingFavoriteId === meal.id) return;
    setSavingFavoriteId(meal.id);
    try {
      await onSaveAsFavorite(meal);
      setSavedFavoriteIds((prev) => ({ ...prev, [meal.id]: true }));
      if (favoriteTimersRef.current[meal.id]) {
        window.clearTimeout(favoriteTimersRef.current[meal.id]);
      }
      favoriteTimersRef.current[meal.id] = window.setTimeout(() => {
        setSavedFavoriteIds((prev) => {
          const next = { ...prev };
          delete next[meal.id];
          return next;
        });
      }, 2400);
    } catch {
      // Parent error banner displays failure details
    } finally {
      setSavingFavoriteId((curr) => (curr === meal.id ? null : curr));
    }
  };

  const handleCopyYesterday = async () => {
    if (!onCopyYesterday || copyingYesterday) return;
    setCopyingYesterday(true);
    setCopyFeedback(null);
    if (copyFeedbackTimerRef.current !== null) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }

    try {
      const result = await onCopyYesterday();
      if (result && typeof result === 'object' && 'copiedCount' in result) {
        if (result.copiedCount === 0) {
          setCopyFeedback({
            tone: 'amber',
            message: `No meals found on ${result.sourceDate} to copy.`,
          });
        } else {
          setCopyFeedback({
            tone: 'mint',
            message: `Copied ${result.copiedCount} ${result.copiedCount === 1 ? 'meal' : 'meals'} from yesterday.`,
          });
        }
      } else {
        setCopyFeedback({
          tone: 'mint',
          message: "Yesterday's meals synced.",
        });
      }
    } catch (err) {
      setCopyFeedback({
        tone: 'coral',
        message: err instanceof Error ? err.message : "Failed to copy yesterday's meals.",
      });
    } finally {
      setCopyingYesterday(false);
      copyFeedbackTimerRef.current = window.setTimeout(() => {
        setCopyFeedback(null);
      }, 4000);
    }
  };

  return (
    <BentoCard
      title="Today's Nutrition Logs"
      subtitle={`${meals.length} ${meals.length === 1 ? 'entry' : 'entries'} · ${Math.round(totalCalories).toLocaleString()} kcal`}
      icon={<Utensils className="h-4 w-4 text-[#2EE6A6]" />}
      headerRight={
        onCopyYesterday || onAddMealClick ? (
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            {onCopyYesterday ? (
              <button
                type="button"
                disabled={copyingYesterday}
                onClick={() => void handleCopyYesterday()}
                title="Copy yesterday's logged meals into today"
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:border-[#38BDF8]/40 hover:bg-[#38BDF8]/10 hover:text-[#38BDF8] disabled:cursor-wait disabled:opacity-60"
              >
                {copyingYesterday ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#38BDF8]" />
                ) : (
                  <Copy className="h-3.5 w-3.5 shrink-0 text-[#38BDF8]" />
                )}
                <span className="whitespace-nowrap">Copy Yesterday</span>
              </button>
            ) : null}
            {onAddMealClick ? (
              <button
                type="button"
                onClick={onAddMealClick}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-white transition hover:border-[#2EE6A6]/40 hover:bg-[#2EE6A6]/10 hover:text-[#2EE6A6]"
              >
                <Plus className="h-3.5 w-3.5 shrink-0" />
                <span>Log Meal</span>
              </button>
            ) : null}
          </div>
        ) : undefined
      }
      accentGlow="mint"
      className="h-full"
    >
      {copyFeedback ? (
        <div
          role="status"
          className={`mb-3 rounded-xl border px-3 py-2 text-xs font-medium ${
            copyFeedback.tone === 'mint'
              ? 'border-[#2EE6A6]/30 bg-[#2EE6A6]/10 text-[#2EE6A6]'
              : copyFeedback.tone === 'amber'
                ? 'border-[#FFB020]/30 bg-[#FFB020]/10 text-[#FFB020]'
                : 'border-[#FF5C6C]/30 bg-[#FF5C6C]/10 text-[#FF8A95]'
          }`}
        >
          {copyFeedback.message}
        </div>
      ) : null}

      {meals.length === 0 ? (
        <div className="flex h-full min-h-[190px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-[#0F131C]/50 px-5 py-8 text-center">
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] text-slate-400">
            <Utensils className="h-5 w-5" />
          </div>
          <p className="text-sm font-medium text-slate-200">No meals logged today</p>
          <p className="mt-1 max-w-xs text-xs text-slate-400">
            Log your first meal or snack to update your remaining calories and macro rings.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
            {onAddMealClick ? (
              <button
                type="button"
                onClick={onAddMealClick}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full bg-[#2EE6A6] px-4 py-2 text-xs font-semibold text-[#081016] transition hover:brightness-110"
              >
                <Plus className="h-3.5 w-3.5" />
                Add First Meal
              </button>
            ) : null}
            {onCopyYesterday ? (
              <button
                type="button"
                disabled={copyingYesterday}
                onClick={() => void handleCopyYesterday()}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-semibold text-slate-200 transition hover:border-[#38BDF8]/40 hover:bg-[#38BDF8]/10 hover:text-[#38BDF8] disabled:opacity-60"
              >
                {copyingYesterday ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-[#38BDF8]" />
                )}
                Copy Yesterday
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <ul className="min-w-0 max-h-[340px] space-y-2.5 overflow-y-auto pr-1">
          {meals.map((meal) => {
            const badge = MEAL_TYPE_BADGE[meal.mealType] ?? MEAL_TYPE_BADGE.snack;
            const timeLabel = formatTime(meal.loggedAt);
            const isSupplement = meal.mealType === 'supplement' || Boolean(meal.supplementKey);
            const isSavingFav = savingFavoriteId === meal.id;
            const isSavedFav = Boolean(savedFavoriteIds[meal.id]);

            return (
              <li
                key={meal.id}
                className="group min-w-0 rounded-2xl border border-white/5 bg-[#0F131C]/80 p-3 transition hover:border-white/10 sm:p-3.5"
              >
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
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
                    <p className="mt-1.5 line-clamp-2 break-words text-sm font-medium text-white sm:truncate">
                      {meal.itemName}
                    </p>
                  </div>

                  <div className="shrink-0 text-right">
                    <span className="tabular-nums text-sm font-bold text-white">
                      {Math.round(meal.calories)}{' '}
                      <span className="text-[11px] font-normal text-slate-400">kcal</span>
                    </span>
                  </div>
                </div>

                {/* P / C / F Macro Pills + Item Actions */}
                <div className="mt-2.5 flex min-w-0 flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
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

                  <div className="-mr-1 flex shrink-0 items-center gap-0.5">
                    {!isSupplement && onSaveAsFavorite ? (
                      <button
                        type="button"
                        disabled={isSavingFav}
                        onClick={() => void handleSaveFavorite(meal)}
                        aria-label={`Save ${meal.itemName} to favorites`}
                        title={isSavedFav ? 'Saved to Favorites' : 'Save as Favorite'}
                        className={`flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl transition disabled:opacity-60 ${
                          isSavedFav
                            ? 'bg-[#2EE6A6]/15 text-[#2EE6A6]'
                            : 'text-slate-500 hover:bg-[#FFB020]/15 hover:text-[#FFB020]'
                        }`}
                      >
                        {isSavingFav ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : isSavedFav ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <BookmarkPlus className="h-3.5 w-3.5" />
                        )}
                      </button>
                    ) : null}

                    {!isSupplement && onEditMeal ? (
                      <button
                        type="button"
                        onClick={() => onEditMeal(meal)}
                        aria-label={`Edit ${meal.itemName}`}
                        title="Edit meal"
                        className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl text-slate-500 transition hover:bg-[#38BDF8]/15 hover:text-[#38BDF8]"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    ) : null}

                    {onDeleteMeal ? (
                      <button
                        type="button"
                        onClick={() => void onDeleteMeal(meal.id)}
                        aria-label={`Delete ${meal.itemName}`}
                        title="Delete meal"
                        className="flex min-h-[38px] min-w-[38px] items-center justify-center rounded-xl text-slate-500 transition hover:bg-[#FF5C6C]/15 hover:text-[#FF5C6C]"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </BentoCard>
  );
}
