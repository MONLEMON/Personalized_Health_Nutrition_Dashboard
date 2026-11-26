import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  UpdateProfileSettingsSchema,
  type BodyMetricDTO,
  type GoalType,
  type Sex,
  type UpdateProfileSettingsInput,
  type UserGoalDTO,
  type UserProfileDTO,
} from '@health-dash/shared';
import { AlertCircle, Check, Flame, Loader2, SlidersHorizontal, Target, User, X } from 'lucide-react';

export interface ProfileSettingsModalProps {
  isOpen: boolean;
  profile: UserProfileDTO;
  goal: UserGoalDTO;
  latestMetric: BodyMetricDTO;
  activeCalories: number;
  isSubmitting?: boolean;
  onClose: () => void;
  onSave: (input: UpdateProfileSettingsInput) => Promise<void>;
}

const ACTIVITY_PRESETS: Array<{ value: number; label: string }> = [
  { value: 1.2, label: '1.2 Sedentary' },
  { value: 1.35, label: '1.35 Light' },
  { value: 1.55, label: '1.55 Moderate' },
  { value: 1.725, label: '1.725 High' },
];

const GOAL_TYPES: Array<{
  value: GoalType;
  label: string;
  defaultAdj: number;
  activeClass: string;
}> = [
  {
    value: 'CUT',
    label: 'CUT',
    defaultAdj: -350,
    activeClass: 'border-[#2EE6A6]/60 bg-[#2EE6A6]/15 text-[#2EE6A6]',
  },
  {
    value: 'MAINTAIN',
    label: 'MAINTAIN',
    defaultAdj: 0,
    activeClass: 'border-[#FFB020]/60 bg-[#FFB020]/15 text-[#FFB020]',
  },
  {
    value: 'BULK',
    label: 'BULK',
    defaultAdj: 300,
    activeClass: 'border-[#38BDF8]/60 bg-[#38BDF8]/15 text-[#38BDF8]',
  },
];

const CALORIE_ADJ_PRESETS = [-500, -350, -200, 0, 250, 350];
const PROTEIN_PRESETS = [1.6, 2.0, 2.2, 2.5];

function computeLivePreview(params: {
  gender: Sex;
  birthDate: string;
  heightCm: string;
  activityMultiplier: string;
  calorieAdjustment: string;
  proteinPerKg: string;
  fatRatioPct: string;
  weightKg: number;
  bodyFatPct: number | null;
  activeCalories: number;
}) {
  const height = Number(params.heightCm);
  const multiplier = Number(params.activityMultiplier);
  const adjustment = Number(params.calorieAdjustment);
  const proteinPerKg = Number(params.proteinPerKg);
  const fatRatio = Number(params.fatRatioPct) / 100;

  if (
    !Number.isFinite(height) ||
    height < 80 ||
    !Number.isFinite(multiplier) ||
    multiplier < 1.1 ||
    !Number.isFinite(proteinPerKg) ||
    !Number.isFinite(fatRatio)
  ) {
    return null;
  }

  let bmr: number;
  let formula: string;
  if (params.bodyFatPct !== null && Number.isFinite(params.bodyFatPct)) {
    const lbm = params.weightKg * (1 - params.bodyFatPct / 100);
    bmr = Math.round(370 + 21.6 * lbm);
    formula = 'Katch-McArdle (LBM)';
  } else {
    const birth = new Date(`${params.birthDate}T00:00:00Z`);
    const now = new Date();
    let age = now.getUTCFullYear() - birth.getUTCFullYear();
    const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) {
      age -= 1;
    }
    const safeAge = Number.isFinite(age) && age > 0 && age < 120 ? age : 30;
    const offset = params.gender === 'male' ? 5 : params.gender === 'female' ? -161 : -78;
    bmr = Math.round(10 * params.weightKg + 6.25 * height - 5 * safeAge + offset);
    formula = 'Mifflin-St Jeor';
  }

  const dynamicTdee = Math.round(bmr * multiplier + params.activeCalories);
  const safeAdj = Number.isFinite(adjustment) ? Math.round(adjustment) : 0;
  const targetCalories = Math.max(1200, Math.round(dynamicTdee + safeAdj));
  const proteinG = Math.round(params.weightKg * proteinPerKg);
  const fatG = Math.round((targetCalories * fatRatio) / 9);
  const carbsG = Math.max(0, Math.round((targetCalories - proteinG * 4 - fatG * 9) / 4));

  return { bmr, formula, dynamicTdee, targetCalories, proteinG, carbsG, fatG };
}

export function ProfileSettingsModal({
  isOpen,
  profile,
  goal,
  latestMetric,
  activeCalories,
  isSubmitting = false,
  onClose,
  onSave,
}: ProfileSettingsModalProps) {
  const [name, setName] = useState(profile.name);
  const [gender, setGender] = useState<Sex>(profile.sex);
  const [birthDate, setBirthDate] = useState(profile.birthDate);
  const [heightCm, setHeightCm] = useState(String(profile.heightCm));
  const [activityMultiplier, setActivityMultiplier] = useState(
    String(profile.baselineActivityMultiplier),
  );
  const [goalType, setGoalType] = useState<GoalType>(goal.goalType);
  const [calorieAdjustment, setCalorieAdjustment] = useState(String(goal.calorieAdjustment));
  const [proteinPerKg, setProteinPerKg] = useState(String(goal.proteinPerKg));
  const [fatRatioPct, setFatRatioPct] = useState(String(Math.round(goal.fatRatio * 100)));
  const [error, setError] = useState<string | null>(null);
  const [localSubmitting, setLocalSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(profile.name);
      setGender(profile.sex);
      setBirthDate(profile.birthDate);
      setHeightCm(String(profile.heightCm));
      setActivityMultiplier(String(profile.baselineActivityMultiplier));
      setGoalType(goal.goalType);
      setCalorieAdjustment(String(goal.calorieAdjustment));
      setProteinPerKg(String(goal.proteinPerKg));
      setFatRatioPct(String(Math.round(goal.fatRatio * 100)));
      setError(null);
    }
  }, [isOpen, profile, goal]);

  const busy = isSubmitting || localSubmitting;

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, busy, onClose]);

  const preview = useMemo(
    () =>
      computeLivePreview({
        gender,
        birthDate,
        heightCm,
        activityMultiplier,
        calorieAdjustment,
        proteinPerKg,
        fatRatioPct,
        weightKg: latestMetric.weightKg,
        bodyFatPct: latestMetric.bodyFatPct,
        activeCalories,
      }),
    [
      gender,
      birthDate,
      heightCm,
      activityMultiplier,
      calorieAdjustment,
      proteinPerKg,
      fatRatioPct,
      latestMetric.weightKg,
      latestMetric.bodyFatPct,
      activeCalories,
    ],
  );

  if (!isOpen) return null;

  const handleSelectGoalType = (opt: (typeof GOAL_TYPES)[number]) => {
    setError(null);
    setGoalType(opt.value);
    if (opt.value !== goalType) {
      setCalorieAdjustment(String(opt.defaultAdj));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = UpdateProfileSettingsSchema.safeParse({
      name: name.trim(),
      gender,
      birth_date: birthDate,
      height_cm: heightCm,
      baseline_activity_multiplier: activityMultiplier,
      goal_type: goalType,
      calorie_adjustment: calorieAdjustment,
      protein_per_kg: proteinPerKg,
      fat_ratio: Number(fatRatioPct) / 100,
    });

    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Please review your profile settings.');
      return;
    }

    try {
      setLocalSubmitting(true);
      await onSave(parsed.data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile settings.');
    } finally {
      setLocalSubmitting(false);
    }
  };

  const inputClasses =
    'min-h-[44px] w-full rounded-xl border border-white/10 bg-[#0A0C10]/85 px-3 py-2 text-base sm:text-sm text-white placeholder:text-slate-500 focus:border-[#2EE6A6]/60 focus:outline-none focus:ring-1 focus:ring-[#2EE6A6]/40';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/75 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-settings-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) {
          onClose();
        }
      }}
    >
      <div className="animate-sheet-up relative max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl rounded-b-none border-t border-x border-white/10 bg-[#141720]/98 px-5 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_-24px_64px_-12px_rgba(0,0,0,0.95)] backdrop-blur-2xl sm:max-w-2xl sm:rounded-3xl sm:border sm:p-6 sm:shadow-[0_32px_80px_-16px_rgba(0,0,0,0.95)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent"
        />
        <div
          aria-hidden="true"
          className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-white/20 sm:hidden"
        />

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#38BDF8]/15 text-[#38BDF8]">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div>
              <h2 id="profile-settings-title" className="text-base font-semibold text-white">
                Profile &amp; Goal Settings
              </h2>
              <p className="text-xs text-slate-400">
                Recalculates BMR, Dynamic TDEE, and daily macro targets live
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close profile settings"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-5">
          {/* Section 1: Identity & Biometrics */}
          <div className="space-y-3 rounded-2xl border border-white/5 bg-[#0F131C]/75 p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <User className="h-3.5 w-3.5 text-[#2EE6A6]" />
              <span>Biometrics &amp; Baseline Activity</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-slate-300">Display Name *</span>
                <input
                  type="text"
                  required
                  maxLength={100}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={`mt-1 ${inputClasses}`}
                />
              </label>

              <div>
                <span className="text-xs font-medium text-slate-300">Gender *</span>
                <div className="mt-1 grid grid-cols-3 gap-1.5">
                  {(['male', 'female', 'other'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setGender(option)}
                      className={`min-h-[44px] cursor-pointer rounded-xl border px-2 text-xs font-semibold capitalize transition ${
                        gender === option
                          ? 'border-[#2EE6A6]/60 bg-[#2EE6A6]/15 text-[#2EE6A6]'
                          : 'border-white/10 bg-[#0A0C10]/85 text-slate-300 hover:bg-white/[0.04]'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-xs font-medium text-slate-300">Birth Date *</span>
                <input
                  type="date"
                  required
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className={`mt-1 ${inputClasses}`}
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-slate-300">Height (cm) *</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.5"
                  min={80}
                  max={260}
                  required
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  className={`mt-1 tabular-nums ${inputClasses}`}
                />
              </label>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-xs font-medium text-slate-300">
                <span>Baseline Activity Multiplier (NEAT)</span>
                <span className="tabular-nums text-[11px] text-slate-400">Range 1.10 – 2.20</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                {ACTIVITY_PRESETS.map((preset) => {
                  const active = Math.abs(Number(activityMultiplier) - preset.value) < 0.005;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setActivityMultiplier(String(preset.value))}
                      className={`min-h-[44px] rounded-xl border px-2.5 text-xs font-semibold transition ${
                        active
                          ? 'border-[#2EE6A6]/60 bg-[#2EE6A6]/15 text-[#2EE6A6]'
                          : 'border-white/10 bg-[#0A0C10]/85 text-slate-300 hover:bg-white/[0.04]'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min={1.1}
                  max={2.2}
                  aria-label="Custom activity multiplier"
                  value={activityMultiplier}
                  onChange={(e) => setActivityMultiplier(e.target.value)}
                  className={`tabular-nums ${inputClasses}`}
                />
              </div>
            </div>
          </div>

          {/* Section 2: Goal & Macro Ratios */}
          <div className="space-y-3 rounded-2xl border border-white/5 bg-[#0F131C]/75 p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <Target className="h-3.5 w-3.5 text-[#FFB020]" />
              <span>Goal &amp; Macro Rules</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {GOAL_TYPES.map((opt) => {
                const active = goalType === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleSelectGoalType(opt)}
                    className={`min-h-[44px] cursor-pointer rounded-xl border px-3 py-2 text-xs font-bold transition ${
                      active
                        ? opt.activeClass
                        : 'border-white/10 bg-[#0A0C10]/85 text-slate-300 hover:bg-white/[0.04]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            <div>
              <span className="text-xs font-medium text-slate-300">
                Calorie Adjustment (kcal/day)
              </span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {CALORIE_ADJ_PRESETS.map((adj) => {
                  const active = Number(calorieAdjustment) === adj;
                  const label = adj > 0 ? `+${adj}` : String(adj);
                  return (
                    <button
                      key={adj}
                      type="button"
                      onClick={() => setCalorieAdjustment(String(adj))}
                      className={`tabular-nums min-h-[38px] rounded-full border px-3 text-xs font-semibold transition ${
                        active
                          ? 'border-[#38BDF8]/60 bg-[#38BDF8]/15 text-[#38BDF8]'
                          : 'border-white/10 bg-[#0A0C10]/85 text-slate-300 hover:bg-white/[0.04]'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              <input
                type="number"
                inputMode="numeric"
                step="25"
                min={-1500}
                max={1500}
                required
                value={calorieAdjustment}
                onChange={(e) => setCalorieAdjustment(e.target.value)}
                className={`mt-2 tabular-nums ${inputClasses}`}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <span className="text-xs font-medium text-[#2EE6A6]">Protein Target (g/kg)</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {PROTEIN_PRESETS.map((val) => {
                    const active = Math.abs(Number(proteinPerKg) - val) < 0.05;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setProteinPerKg(String(val))}
                        className={`tabular-nums min-h-[36px] rounded-full border px-2.5 text-xs font-semibold transition ${
                          active
                            ? 'border-[#2EE6A6]/60 bg-[#2EE6A6]/15 text-[#2EE6A6]'
                            : 'border-white/10 bg-[#0A0C10]/85 text-slate-300 hover:bg-white/[0.04]'
                        }`}
                      >
                        {val}g
                      </button>
                    );
                  })}
                </div>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min={0.8}
                  max={3.5}
                  required
                  value={proteinPerKg}
                  onChange={(e) => setProteinPerKg(e.target.value)}
                  className={`mt-2 tabular-nums ${inputClasses}`}
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-xs font-medium text-[#FBBF24]">
                  <span>Fat Ratio (% of Target kcal)</span>
                  <span className="tabular-nums font-bold">{fatRatioPct}%</span>
                </div>
                <input
                  type="range"
                  min={15}
                  max={50}
                  step={1}
                  value={Math.min(50, Math.max(15, Number(fatRatioPct) || 25))}
                  onChange={(e) => setFatRatioPct(e.target.value)}
                  className="mt-3 h-2 w-full cursor-pointer accent-[#FBBF24]"
                />
                <div className="mt-2 flex items-center gap-2">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={15}
                    max={50}
                    step={1}
                    required
                    value={fatRatioPct}
                    onChange={(e) => setFatRatioPct(e.target.value)}
                    className={`tabular-nums ${inputClasses}`}
                  />
                  <span className="text-xs text-slate-400">% (15–50%)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Live Preview Card */}
          {preview ? (
            <div className="rounded-2xl border border-[#2EE6A6]/25 bg-gradient-to-br from-[#2EE6A6]/10 via-[#141720] to-[#38BDF8]/10 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-white">
                  <Flame className="h-4 w-4 text-[#FFB020]" />
                  <span>Live Target Preview</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-slate-300">
                    {preview.formula}
                  </span>
                </div>
                <div className="tabular-nums text-xs text-slate-300">
                  Weight {latestMetric.weightKg.toFixed(1)} kg · +{activeCalories} active kcal
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-[#0A0C10]/85 px-3 py-2.5">
                  <div className="text-[11px] text-slate-400">Target Calories</div>
                  <div className="tabular-nums mt-0.5 text-lg font-bold text-[#2EE6A6]">
                    {preview.targetCalories.toLocaleString()} kcal
                  </div>
                </div>
                <div className="rounded-xl border border-white/10 bg-[#0A0C10]/85 px-3 py-2.5">
                  <div className="text-[11px] text-slate-400">Dynamic TDEE</div>
                  <div className="tabular-nums mt-0.5 text-base font-bold text-white">
                    {preview.dynamicTdee.toLocaleString()} kcal
                  </div>
                </div>
                <div className="col-span-2 rounded-xl border border-white/10 bg-[#0A0C10]/85 px-3 py-2.5 sm:col-span-1">
                  <div className="text-[11px] text-slate-400">Resting BMR</div>
                  <div className="tabular-nums mt-0.5 text-base font-bold text-slate-200">
                    {preview.bmr.toLocaleString()} kcal
                  </div>
                </div>
              </div>

              <div className="mt-2.5 grid grid-cols-3 gap-2">
                <div className="rounded-xl border border-[#2EE6A6]/25 bg-[#2EE6A6]/10 px-3 py-2 text-center">
                  <div className="text-[10px] font-semibold uppercase text-[#2EE6A6]">Protein</div>
                  <div className="tabular-nums text-sm font-bold text-white">
                    {preview.proteinG}g
                  </div>
                </div>
                <div className="rounded-xl border border-[#38BDF8]/25 bg-[#38BDF8]/10 px-3 py-2 text-center">
                  <div className="text-[10px] font-semibold uppercase text-[#38BDF8]">Carbs</div>
                  <div className="tabular-nums text-sm font-bold text-white">{preview.carbsG}g</div>
                </div>
                <div className="rounded-xl border border-[#FBBF24]/25 bg-[#FBBF24]/10 px-3 py-2 text-center">
                  <div className="text-[10px] font-semibold uppercase text-[#FBBF24]">Fat</div>
                  <div className="tabular-nums text-sm font-bold text-white">{preview.fatG}g</div>
                </div>
              </div>
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-2xl border border-[#FF5C6C]/35 bg-[#FF5C6C]/12 px-3.5 py-2.5 text-xs font-medium text-[#FF8A95]"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#FF5C6C]" />
              <span>{error}</span>
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2.5 pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={onClose}
              className="min-h-[44px] flex-1 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-50 sm:flex-none sm:text-xs"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-2xl bg-[#2EE6A6] px-5 py-2.5 text-sm font-bold text-[#081016] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60 sm:flex-none sm:text-xs"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              <span>Save Settings</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
