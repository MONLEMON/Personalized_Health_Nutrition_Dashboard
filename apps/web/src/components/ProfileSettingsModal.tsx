import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CalorieCyclingConfigSchema,
  UpdateProfileSettingsSchema,
  type BodyMetricDTO,
  type CalorieCyclingConfig,
  type CalorieCyclingMode,
  type GoalType,
  type Sex,
  type TdeeMode,
  type UpdateProfileSettingsInput,
  type UserGoalDTO,
  type UserProfileDTO,
  type WeekdayKey,
} from '@health-dash/shared';
import {
  AlertCircle,
  Check,
  Flame,
  Gauge,
  Loader2,
  Repeat,
  SlidersHorizontal,
  Target,
  User,
  X,
} from 'lucide-react';

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

const TDEE_MODE_OPTIONS: Array<{
  value: TdeeMode;
  title: string;
  defaultMultiplier: number;
  summary: string;
}> = [
  {
    value: 'APPLE_HEALTH_DYNAMIC',
    title: 'Apple Health Dynamic',
    defaultMultiplier: 1.1,
    summary: 'Base 1.1× (BMR + TEF) + Watch All-Day Active Energy (no NEAT double-counting)',
  },
  {
    value: 'MANUAL_WORKOUT_DYNAMIC',
    title: 'Workout Dynamic',
    defaultMultiplier: 1.25,
    summary: 'Base NEAT 1.2–1.3× (daily life) + logged Workout calories added daily',
  },
  {
    value: 'FIXED_STATIC',
    title: 'Fixed Static TDEE',
    defaultMultiplier: 1.55,
    summary: 'All-in weekly multiplier (1.35–1.725×); active burn tracked without shifting target',
  },
];

const ACTIVITY_PRESETS_BY_MODE: Record<
  TdeeMode,
  Array<{ value: number; label: string }>
> = {
  APPLE_HEALTH_DYNAMIC: [
    { value: 1.0, label: '1.0 BMR Only' },
    { value: 1.1, label: '1.1 BMR+TEF' },
    { value: 1.15, label: '1.15 Light Base' },
    { value: 1.2, label: '1.2 Active Base' },
  ],
  MANUAL_WORKOUT_DYNAMIC: [
    { value: 1.2, label: '1.2 Sedentary NEAT' },
    { value: 1.25, label: '1.25 Desk NEAT' },
    { value: 1.3, label: '1.3 Walk NEAT' },
    { value: 1.4, label: '1.4 Active Job' },
  ],
  FIXED_STATIC: [
    { value: 1.2, label: '1.2 Sedentary' },
    { value: 1.35, label: '1.35 Light (1-3d)' },
    { value: 1.55, label: '1.55 Mod (3-5d)' },
    { value: 1.725, label: '1.725 High (6-7d)' },
  ],
};

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

type ActiveCyclingMode = Exclude<CalorieCyclingMode, 'NONE'>;

const WEEKDAYS: Array<{ key: WeekdayKey; label: string }> = [
  { key: 'mon', label: 'Mon' },
  { key: 'tue', label: 'Tue' },
  { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' },
  { key: 'fri', label: 'Fri' },
  { key: 'sat', label: 'Sat' },
  { key: 'sun', label: 'Sun' },
];

const DEFAULT_TRAINING_DAYS: WeekdayKey[] = ['mon', 'wed', 'fri', 'sat'];

const ZERO_DAY_OFFSETS: Record<WeekdayKey, string> = {
  mon: '0',
  tue: '0',
  wed: '0',
  thu: '0',
  fri: '0',
  sat: '0',
  sun: '0',
};

const WEEKEND_BUFFER_PRESETS: Array<{
  label: string;
  weekdayOffset: number;
  weekendOffset: number;
}> = [
  { label: '-100 / +250', weekdayOffset: -100, weekendOffset: 250 },
  { label: '-120 / +300', weekdayOffset: -120, weekendOffset: 300 },
  { label: '-150 / +375', weekdayOffset: -150, weekendOffset: 375 },
];

function buildDayOffsetsStrings(
  offsets?: Record<WeekdayKey, number> | null,
  fallback?: Record<WeekdayKey, string>,
): Record<WeekdayKey, string> {
  if (!offsets) {
    return { ...(fallback ?? ZERO_DAY_OFFSETS) };
  }
  return {
    mon: String(offsets.mon ?? 0),
    tue: String(offsets.tue ?? 0),
    wed: String(offsets.wed ?? 0),
    thu: String(offsets.thu ?? 0),
    fri: String(offsets.fri ?? 0),
    sat: String(offsets.sat ?? 0),
    sun: String(offsets.sun ?? 0),
  };
}

function buildWeekendPresetStrings(
  weekdayOffset: number,
  weekendOffset: number,
): Record<WeekdayKey, string> {
  return {
    mon: String(weekdayOffset),
    tue: String(weekdayOffset),
    wed: String(weekdayOffset),
    thu: String(weekdayOffset),
    fri: String(weekdayOffset),
    sat: String(weekendOffset),
    sun: String(weekendOffset),
  };
}

function parseIntOrZero(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function computeLivePreview(params: {
  gender: Sex;
  birthDate: string;
  heightCm: string;
  activityMultiplier: string;
  tdeeMode: TdeeMode;
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
    multiplier < 1.0 ||
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

  const effectiveActive =
    params.tdeeMode === 'FIXED_STATIC' ? 0 : Math.round(params.activeCalories);
  const dynamicTdee = Math.round(bmr * multiplier + effectiveActive);
  const safeAdj = Number.isFinite(adjustment) ? Math.round(adjustment) : 0;
  const targetCalories = Math.max(1200, Math.round(dynamicTdee + safeAdj));
  const proteinG = Math.round(params.weightKg * proteinPerKg);
  const fatG = Math.round((targetCalories * fatRatio) / 9);
  const carbsG = Math.max(0, Math.round((targetCalories - proteinG * 4 - fatG * 9) / 4));

  return { bmr, formula, effectiveActive, dynamicTdee, targetCalories, proteinG, carbsG, fatG };
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
  const [tdeeMode, setTdeeMode] = useState<TdeeMode>(
    profile.tdeeMode ?? 'MANUAL_WORKOUT_DYNAMIC',
  );
  const [goalType, setGoalType] = useState<GoalType>(goal.goalType);
  const [calorieAdjustment, setCalorieAdjustment] = useState(String(goal.calorieAdjustment));
  const [proteinPerKg, setProteinPerKg] = useState(String(goal.proteinPerKg));
  const [fatRatioPct, setFatRatioPct] = useState(String(Math.round(goal.fatRatio * 100)));

  const initialCycling = goal.calorieCycling;
  const [cyclingEnabled, setCyclingEnabled] = useState<boolean>(
    Boolean(initialCycling?.enabled && initialCycling.mode !== 'NONE'),
  );
  const [cyclingMode, setCyclingMode] = useState<ActiveCyclingMode>(
    initialCycling?.mode && initialCycling.mode !== 'NONE'
      ? initialCycling.mode
      : 'TRAINING_REST',
  );
  const [trainingDays, setTrainingDays] = useState<WeekdayKey[]>(
    initialCycling?.trainingDays?.length ? initialCycling.trainingDays : DEFAULT_TRAINING_DAYS,
  );
  const [trainingDayOffset, setTrainingDayOffset] = useState<string>(
    String(initialCycling?.trainingDayOffset ?? 200),
  );
  const [restDayOffset, setRestDayOffset] = useState<string>(
    String(initialCycling?.restDayOffset ?? -150),
  );
  const [dayOffsets, setDayOffsets] = useState<Record<WeekdayKey, string>>(() =>
    buildDayOffsetsStrings(initialCycling?.dayOffsets),
  );

  const [error, setError] = useState<string | null>(null);
  const [localSubmitting, setLocalSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(profile.name);
      setGender(profile.sex);
      setBirthDate(profile.birthDate);
      setHeightCm(String(profile.heightCm));
      setActivityMultiplier(String(profile.baselineActivityMultiplier));
      setTdeeMode(profile.tdeeMode ?? 'MANUAL_WORKOUT_DYNAMIC');
      setGoalType(goal.goalType);
      setCalorieAdjustment(String(goal.calorieAdjustment));
      setProteinPerKg(String(goal.proteinPerKg));
      setFatRatioPct(String(Math.round(goal.fatRatio * 100)));

      const cfg = goal.calorieCycling;
      setCyclingEnabled(Boolean(cfg?.enabled && cfg.mode !== 'NONE'));
      setCyclingMode(cfg?.mode && cfg.mode !== 'NONE' ? cfg.mode : 'TRAINING_REST');
      setTrainingDays(cfg?.trainingDays?.length ? cfg.trainingDays : DEFAULT_TRAINING_DAYS);
      setTrainingDayOffset(String(cfg?.trainingDayOffset ?? 200));
      setRestDayOffset(String(cfg?.restDayOffset ?? -150));
      setDayOffsets(buildDayOffsetsStrings(cfg?.dayOffsets));

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
        tdeeMode,
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
      tdeeMode,
      calorieAdjustment,
      proteinPerKg,
      fatRatioPct,
      latestMetric.weightKg,
      latestMetric.bodyFatPct,
      activeCalories,
    ],
  );

  const cyclingPreview = useMemo(() => {
    const baseTarget = preview?.targetCalories ?? 2200;
    const proteinG = preview?.proteinG ?? 0;
    const fatG = preview?.fatG ?? 0;

    const days = WEEKDAYS.map(({ key, label }) => {
      let offset = 0;
      if (cyclingEnabled) {
        if (cyclingMode === 'TRAINING_REST') {
          offset = trainingDays.includes(key)
            ? parseIntOrZero(trainingDayOffset)
            : parseIntOrZero(restDayOffset);
        } else {
          offset = parseIntOrZero(dayOffsets[key]);
        }
      }
      const targetCalories = Math.max(1200, Math.round(baseTarget + offset));
      const carbsG = Math.max(
        0,
        Math.round((targetCalories - proteinG * 4 - fatG * 9) / 4),
      );
      return { key, label, offset, targetCalories, carbsG };
    });

    const netWeeklyDelta = days.reduce((sum, d) => sum + d.offset, 0);
    return { days, netWeeklyDelta };
  }, [
    cyclingEnabled,
    cyclingMode,
    dayOffsets,
    preview?.fatG,
    preview?.proteinG,
    preview?.targetCalories,
    restDayOffset,
    trainingDayOffset,
    trainingDays,
  ]);

  if (!isOpen) return null;

  const handleSelectGoalType = (opt: (typeof GOAL_TYPES)[number]) => {
    setError(null);
    setGoalType(opt.value);
    if (opt.value !== goalType) {
      setCalorieAdjustment(String(opt.defaultAdj));
    }
  };

  const handleSelectCyclingMode = (nextMode: ActiveCyclingMode) => {
    setCyclingMode(nextMode);
    if (nextMode === 'WEEKEND_BUFFER') {
      const numericValues = WEEKDAYS.map((d) => parseIntOrZero(dayOffsets[d.key]));
      const allZero = numericValues.every((v) => v === 0);
      const isBalancedWeekend =
        numericValues[0] === numericValues[1] &&
        numericValues[1] === numericValues[2] &&
        numericValues[2] === numericValues[3] &&
        numericValues[3] === numericValues[4] &&
        numericValues[5] === numericValues[6] &&
        numericValues.reduce((a, b) => a + b, 0) === 0 &&
        numericValues[5] > 0;
      if (allZero || !isBalancedWeekend) {
        setDayOffsets(buildWeekendPresetStrings(-100, 250));
      }
    } else if (nextMode === 'CUSTOM') {
      const allZero = WEEKDAYS.every((d) => parseIntOrZero(dayOffsets[d.key]) === 0);
      if (allZero && cyclingMode === 'TRAINING_REST') {
        const seeded: Record<WeekdayKey, string> = { ...ZERO_DAY_OFFSETS };
        for (const { key } of WEEKDAYS) {
          seeded[key] = trainingDays.includes(key) ? trainingDayOffset : restDayOffset;
        }
        setDayOffsets(seeded);
      }
    }
  };

  const handleToggleTrainingDay = (day: WeekdayKey) => {
    setTrainingDays((prev) =>
      prev.includes(day) ? prev.filter((item) => item !== day) : [...prev, day],
    );
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const candidateCycling: CalorieCyclingConfig = {
      enabled: cyclingEnabled,
      mode: cyclingEnabled ? cyclingMode : (goal.calorieCycling?.mode ?? 'NONE'),
      dayOffsets: {
        mon: dayOffsets.mon === '' ? 0 : Number(dayOffsets.mon),
        tue: dayOffsets.tue === '' ? 0 : Number(dayOffsets.tue),
        wed: dayOffsets.wed === '' ? 0 : Number(dayOffsets.wed),
        thu: dayOffsets.thu === '' ? 0 : Number(dayOffsets.thu),
        fri: dayOffsets.fri === '' ? 0 : Number(dayOffsets.fri),
        sat: dayOffsets.sat === '' ? 0 : Number(dayOffsets.sat),
        sun: dayOffsets.sun === '' ? 0 : Number(dayOffsets.sun),
      },
      trainingDayOffset: trainingDayOffset === '' ? 200 : Number(trainingDayOffset),
      restDayOffset: restDayOffset === '' ? -150 : Number(restDayOffset),
      trainingDays,
    };

    const safeDisabledFallback: CalorieCyclingConfig = {
      enabled: false,
      mode: 'NONE',
      dayOffsets: { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0, sat: 0, sun: 0 },
      trainingDayOffset: 200,
      restDayOffset: -150,
      trainingDays: DEFAULT_TRAINING_DAYS,
    };

    const cyclingParsed = CalorieCyclingConfigSchema.safeParse(candidateCycling);
    if (cyclingEnabled && !cyclingParsed.success) {
      setError(
        cyclingParsed.error.issues[0]?.message ?? 'Please check your calorie cycling offsets.',
      );
      return;
    }

    const calorieCyclingPayload: CalorieCyclingConfig = cyclingParsed.success
      ? cyclingParsed.data
      : safeDisabledFallback;

    const parsed = UpdateProfileSettingsSchema.safeParse({
      name: name.trim(),
      gender,
      birth_date: birthDate,
      height_cm: heightCm,
      baseline_activity_multiplier: activityMultiplier,
      tdee_mode: tdeeMode,
      goal_type: goalType,
      calorie_adjustment: calorieAdjustment,
      protein_per_kg: proteinPerKg,
      fat_ratio: Number(fatRatioPct) / 100,
      calorie_cycling: calorieCyclingPayload,
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
    'min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-[#0A0C10]/85 px-3 py-2 text-base sm:text-sm text-white placeholder:text-slate-500 focus:border-[#2EE6A6]/60 focus:outline-none focus:ring-1 focus:ring-[#2EE6A6]/40';

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
      <div className="animate-sheet-up relative max-h-[92dvh] w-full overflow-x-hidden overflow-y-auto rounded-t-3xl rounded-b-none border-t border-x border-white/10 bg-[#141720]/98 px-4 pt-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-[0_-24px_64px_-12px_rgba(0,0,0,0.95)] backdrop-blur-2xl sm:max-w-2xl sm:rounded-3xl sm:border sm:p-6 sm:shadow-[0_32px_80px_-16px_rgba(0,0,0,0.95)]">
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
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#38BDF8]/15 text-[#38BDF8]">
              <SlidersHorizontal className="h-4 w-4" />
            </div>
            <div className="min-w-0">
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
            className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 min-w-0 space-y-5">
          {/* Section 1: Identity & Biometrics */}
          <div className="min-w-0 space-y-3 rounded-2xl border border-white/5 bg-[#0F131C]/75 p-3.5 sm:p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <User className="h-3.5 w-3.5 shrink-0 text-[#2EE6A6]" />
              <span>Biometrics &amp; Baseline Activity</span>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block min-w-0">
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

              <div className="min-w-0">
                <span className="text-xs font-medium text-slate-300">Gender *</span>
                <div className="mt-1 grid grid-cols-3 gap-1.5">
                  {(['male', 'female', 'other'] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setGender(option)}
                      className={`min-h-[44px] min-w-0 cursor-pointer rounded-xl border px-2 text-xs font-semibold capitalize transition ${
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
              <label className="block min-w-0">
                <span className="text-xs font-medium text-slate-300">Birth Date *</span>
                <input
                  type="date"
                  required
                  value={birthDate}
                  onChange={(e) => setBirthDate(e.target.value)}
                  className={`mt-1 appearance-none ${inputClasses}`}
                />
              </label>

              <label className="block min-w-0">
                <span className="text-xs font-medium text-slate-300">Height (cm) *</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={80}
                  max={260}
                  required
                  value={heightCm}
                  onChange={(e) => setHeightCm(e.target.value)}
                  className={`mt-1 tabular-nums ${inputClasses}`}
                />
              </label>
            </div>

            <div className="min-w-0 space-y-2.5 border-t border-white/5 pt-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Gauge className="h-3.5 w-3.5 shrink-0 text-[#2EE6A6]" />
                <span>TDEE Calculation Engine</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {TDEE_MODE_OPTIONS.map((opt) => {
                  const active = tdeeMode === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setTdeeMode(opt.value);
                        setActivityMultiplier(String(opt.defaultMultiplier));
                      }}
                      className={`flex min-h-[44px] min-w-0 flex-col items-start rounded-xl border px-3 py-2 text-left transition ${
                        active
                          ? 'border-[#2EE6A6]/60 bg-[#2EE6A6]/12 text-[#2EE6A6]'
                          : 'border-white/10 bg-[#0A0C10]/85 text-slate-300 hover:bg-white/[0.04]'
                      }`}
                    >
                      <span className="text-xs font-semibold leading-snug">{opt.title}</span>
                      <span className="mt-0.5 text-[10px] leading-snug text-slate-400">
                        {opt.summary}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-w-0">
              <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1 text-xs font-medium text-slate-300">
                <span>
                  {tdeeMode === 'FIXED_STATIC'
                    ? 'Static All-In Activity Multiplier'
                    : tdeeMode === 'APPLE_HEALTH_DYNAMIC'
                      ? 'Watch Baseline Multiplier (BMR + TEF)'
                      : 'Baseline Activity Multiplier (NEAT)'}
                </span>
                <span className="tabular-nums text-[11px] text-slate-400">Range 1.00 – 2.20</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
                {ACTIVITY_PRESETS_BY_MODE[tdeeMode].map((preset) => {
                  const active = Math.abs(Number(activityMultiplier) - preset.value) < 0.005;
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() => setActivityMultiplier(String(preset.value))}
                      className={`min-h-[44px] min-w-0 truncate rounded-xl border px-2 text-xs font-semibold transition sm:px-2.5 ${
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
                  step="any"
                  min={1.0}
                  max={2.2}
                  aria-label="Custom activity multiplier"
                  value={activityMultiplier}
                  onChange={(e) => setActivityMultiplier(e.target.value)}
                  className={`tabular-nums ${inputClasses}`}
                />
              </div>
              {tdeeMode === 'APPLE_HEALTH_DYNAMIC' && Number(activityMultiplier) > 1.25 && (
                <p className="mt-2 rounded-xl border border-[#FFB020]/30 bg-[#FFB020]/10 px-3 py-2 text-[11px] leading-snug text-[#FFB020]">
                  Apple Watch Active Energy already tracks steps &amp; daily movement. Using a multiplier above 1.25× will double-count NEAT — 1.10× (BMR + TEF) is recommended.
                </p>
              )}
            </div>
          </div>

          {/* Section 2: Goal & Macro Ratios */}
          <div className="min-w-0 space-y-3 rounded-2xl border border-white/5 bg-[#0F131C]/75 p-3.5 sm:p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <Target className="h-3.5 w-3.5 shrink-0 text-[#FFB020]" />
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
                    className={`min-h-[44px] min-w-0 cursor-pointer rounded-xl border px-2 py-2 text-xs font-bold transition sm:px-3 ${
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

            <div className="min-w-0">
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
                step="1"
                min={-1500}
                max={1500}
                required
                value={calorieAdjustment}
                onChange={(e) => setCalorieAdjustment(e.target.value)}
                className={`mt-2 tabular-nums ${inputClasses}`}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0">
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
                  step="any"
                  min={0.8}
                  max={3.5}
                  required
                  value={proteinPerKg}
                  onChange={(e) => setProteinPerKg(e.target.value)}
                  className={`mt-2 tabular-nums ${inputClasses}`}
                />
              </div>

              <div className="min-w-0">
                <div className="flex items-center justify-between gap-2 text-xs font-medium text-[#FBBF24]">
                  <span>Fat Ratio (% of Target kcal)</span>
                  <span className="tabular-nums shrink-0 font-bold">{fatRatioPct}%</span>
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
                <div className="mt-2 flex min-w-0 items-center gap-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={15}
                    max={50}
                    step="any"
                    required
                    value={fatRatioPct}
                    onChange={(e) => setFatRatioPct(e.target.value)}
                    className={`min-w-0 flex-1 tabular-nums ${inputClasses}`}
                  />
                  <span className="shrink-0 whitespace-nowrap text-xs text-slate-400">
                    % (15–50%)
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Calorie & Carb Cycling */}
          <div className="min-w-0 space-y-3.5 rounded-2xl border border-white/5 bg-[#0F131C]/75 p-3.5 sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                <Repeat className="h-3.5 w-3.5 shrink-0 text-[#38BDF8]" />
                <span>Calorie &amp; Carb Cycling</span>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={cyclingEnabled}
                aria-label="Enable Cycling"
                onClick={() => setCyclingEnabled((prev) => !prev)}
                className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-2.5 rounded-xl px-2 text-xs font-semibold text-slate-200 transition hover:bg-white/[0.04]"
              >
                <span className={cyclingEnabled ? 'text-[#2EE6A6]' : 'text-slate-400'}>
                  Enable Cycling
                </span>
                <span
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition ${
                    cyclingEnabled
                      ? 'border-[#2EE6A6]/60 bg-[#2EE6A6]/25'
                      : 'border-white/15 bg-white/10'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full transition ${
                      cyclingEnabled
                        ? 'translate-x-6 bg-[#2EE6A6]'
                        : 'translate-x-1 bg-slate-400'
                    }`}
                  />
                </span>
              </button>
            </div>

            {cyclingEnabled ? (
              <div className="min-w-0 space-y-3.5">
                {/* Mode Selector */}
                <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
                  {(
                    [
                      { id: 'TRAINING_REST', label: 'Training / Rest' },
                      { id: 'WEEKEND_BUFFER', label: 'Weekend Buffer' },
                      { id: 'CUSTOM', label: 'Custom 7-Day' },
                    ] as const
                  ).map((modeOpt) => {
                    const active = cyclingMode === modeOpt.id;
                    return (
                      <button
                        key={modeOpt.id}
                        type="button"
                        onClick={() => handleSelectCyclingMode(modeOpt.id)}
                        className={`min-h-[44px] min-w-0 cursor-pointer rounded-xl border px-1.5 py-2 text-[11px] leading-tight font-semibold transition sm:px-2 sm:text-xs ${
                          active
                            ? 'border-[#38BDF8]/60 bg-[#38BDF8]/15 text-[#38BDF8]'
                            : 'border-white/10 bg-[#0A0C10]/85 text-slate-300 hover:bg-white/[0.04]'
                        }`}
                      >
                        {modeOpt.label}
                      </button>
                    );
                  })}
                </div>

                {/* Mode 1: Training / Rest */}
                {cyclingMode === 'TRAINING_REST' ? (
                  <div className="min-w-0 space-y-3">
                    <div className="min-w-0">
                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1 text-xs text-slate-300">
                        <span className="font-medium">Scheduled Training Days</span>
                        <span className="text-[11px] text-slate-400">
                          Auto-upgrades on logged workout days too
                        </span>
                      </div>
                      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                        {WEEKDAYS.map(({ key, label }) => {
                          const isSelected = trainingDays.includes(key);
                          return (
                            <button
                              key={key}
                              type="button"
                              aria-pressed={isSelected}
                              onClick={() => handleToggleTrainingDay(key)}
                              className={`min-h-[44px] min-w-0 cursor-pointer rounded-xl border px-0.5 text-[11px] font-semibold transition sm:text-xs ${
                                isSelected
                                  ? 'border-[#2EE6A6]/60 bg-[#2EE6A6]/15 text-[#2EE6A6]'
                                  : 'border-white/10 bg-[#0A0C10]/85 text-slate-400 hover:bg-white/[0.04]'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <label className="block min-w-0">
                        <span className="text-xs font-medium text-[#2EE6A6]">
                          Training Day Offset (kcal)
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={-500}
                          max={800}
                          step={1}
                          value={trainingDayOffset}
                          onChange={(e) => setTrainingDayOffset(e.target.value)}
                          className={`mt-1 tabular-nums ${inputClasses}`}
                        />
                      </label>

                      <label className="block min-w-0">
                        <span className="text-xs font-medium text-[#FFB020]">
                          Rest Day Offset (kcal)
                        </span>
                        <input
                          type="number"
                          inputMode="numeric"
                          min={-800}
                          max={500}
                          step={1}
                          value={restDayOffset}
                          onChange={(e) => setRestDayOffset(e.target.value)}
                          className={`mt-1 tabular-nums ${inputClasses}`}
                        />
                      </label>
                    </div>
                  </div>
                ) : null}

                {/* Mode 2: Weekend Buffer */}
                {cyclingMode === 'WEEKEND_BUFFER' ? (
                  <div className="min-w-0 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-slate-300">
                      <span className="font-medium">Weekday Save / Weekend Buffer Presets</span>
                      <span className="text-[11px] text-[#2EE6A6]">Net ±0 kcal/week</span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      {WEEKEND_BUFFER_PRESETS.map((preset) => {
                        const isActive =
                          Number(dayOffsets.mon) === preset.weekdayOffset &&
                          Number(dayOffsets.fri) === preset.weekdayOffset &&
                          Number(dayOffsets.sat) === preset.weekendOffset &&
                          Number(dayOffsets.sun) === preset.weekendOffset;
                        return (
                          <button
                            key={preset.label}
                            type="button"
                            onClick={() =>
                              setDayOffsets(
                                buildWeekendPresetStrings(
                                  preset.weekdayOffset,
                                  preset.weekendOffset,
                                ),
                              )
                            }
                            className={`tabular-nums min-h-[44px] min-w-0 cursor-pointer rounded-xl border px-3 text-xs font-semibold transition ${
                              isActive
                                ? 'border-[#2EE6A6]/60 bg-[#2EE6A6]/15 text-[#2EE6A6]'
                                : 'border-white/10 bg-[#0A0C10]/85 text-slate-300 hover:bg-white/[0.04]'
                            }`}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Saves calories Mon–Fri so Sat–Sun have extra room without breaking your weekly target.
                    </p>
                  </div>
                ) : null}

                {/* Mode 3: Custom 7-Day */}
                {cyclingMode === 'CUSTOM' ? (
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-1 text-xs text-slate-300">
                      <span className="font-medium">Custom 7-Day Offsets (kcal)</span>
                      <span className="text-[11px] text-slate-400">Range -800 to +800</span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-7">
                      {WEEKDAYS.map(({ key, label }) => (
                        <label key={key} className="block min-w-0">
                          <span className="text-[11px] font-medium text-slate-400">{label}</span>
                          <input
                            type="number"
                            inputMode="numeric"
                            min={-800}
                            max={800}
                            step={1}
                            aria-label={`${label} calorie offset`}
                            value={dayOffsets[key]}
                            onChange={(e) =>
                              setDayOffsets((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                            className="mt-1 min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-[#0A0C10]/85 px-2 py-1.5 text-center text-base tabular-nums text-white focus:border-[#38BDF8]/60 focus:outline-none sm:text-sm"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Live 7-Day Preview Strip */}
                <div className="min-w-0 rounded-xl border border-white/10 bg-[#0A0C10]/80 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-white">
                      Live 7-Day Target Preview
                    </span>
                    <span
                      className={`tabular-nums rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                        cyclingPreview.netWeeklyDelta === 0
                          ? 'border-[#2EE6A6]/35 bg-[#2EE6A6]/12 text-[#2EE6A6]'
                          : cyclingPreview.netWeeklyDelta > 0
                            ? 'border-[#38BDF8]/35 bg-[#38BDF8]/12 text-[#38BDF8]'
                            : 'border-[#FFB020]/35 bg-[#FFB020]/12 text-[#FFB020]'
                      }`}
                    >
                      Net Weekly:{' '}
                      {cyclingPreview.netWeeklyDelta === 0
                        ? '±0 kcal (Balanced)'
                        : `${cyclingPreview.netWeeklyDelta > 0 ? '+' : ''}${cyclingPreview.netWeeklyDelta} kcal`}
                    </span>
                  </div>

                  <div className="no-scrollbar mt-2.5 flex gap-1.5 overflow-x-auto pb-1 snap-x snap-mandatory sm:grid sm:grid-cols-7 sm:overflow-visible sm:pb-0">
                    {cyclingPreview.days.map((day) => {
                      const offsetTone =
                        day.offset > 0
                          ? 'border-[#2EE6A6]/35 bg-[#2EE6A6]/10 text-[#2EE6A6]'
                          : day.offset < 0
                            ? 'border-[#FFB020]/35 bg-[#FFB020]/10 text-[#FFB020]'
                            : 'border-white/10 bg-white/[0.03] text-slate-300';
                      return (
                        <div
                          key={day.key}
                          className={`min-w-[68px] shrink-0 snap-start rounded-lg border px-1.5 py-2 text-center sm:min-w-0 sm:shrink ${offsetTone}`}
                        >
                          <div className="text-[10px] font-semibold uppercase">{day.label}</div>
                          <div className="tabular-nums mt-0.5 truncate text-[11px] font-bold text-white">
                            {day.targetCalories.toLocaleString()}
                          </div>
                          <div className="tabular-nums truncate text-[9px]">
                            {day.offset > 0 ? `+${day.offset}` : day.offset}
                          </div>
                          {preview ? (
                            <div className="tabular-nums truncate text-[9px] text-[#38BDF8]">
                              {day.carbsG}g C
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <p className="mt-2 text-[11px] text-slate-400">
                    True Carb Cycling: Carbohydrates adjust automatically on high/low days while Protein and Fat stay fixed.
                  </p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">
                Off — daily calorie and carbohydrate targets stay uniform every day of the week.
              </p>
            )}
          </div>

          {/* Live Preview Card */}
          {preview ? (
            <div className="min-w-0 rounded-2xl border border-[#2EE6A6]/25 bg-gradient-to-br from-[#2EE6A6]/10 via-[#141720] to-[#38BDF8]/10 p-3.5 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-white">
                  <Flame className="h-4 w-4 shrink-0 text-[#FFB020]" />
                  <span>Live Target Preview</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-slate-300">
                    {preview.formula}
                  </span>
                </div>
                <div className="tabular-nums text-xs text-slate-300">
                  Weight {latestMetric.weightKg.toFixed(1)} kg ·{' '}
                  {tdeeMode === 'FIXED_STATIC'
                    ? 'Static TDEE (active tracked only)'
                    : `+${preview.effectiveActive} active kcal`}
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                <div className="min-w-0 rounded-xl border border-white/10 bg-[#0A0C10]/85 px-3 py-2.5">
                  <div className="text-[11px] text-slate-400">Target Calories</div>
                  <div className="tabular-nums mt-0.5 text-lg font-bold text-[#2EE6A6]">
                    {preview.targetCalories.toLocaleString()} kcal
                  </div>
                </div>
                <div className="min-w-0 rounded-xl border border-white/10 bg-[#0A0C10]/85 px-3 py-2.5">
                  <div className="text-[11px] text-slate-400">Dynamic TDEE</div>
                  <div className="tabular-nums mt-0.5 text-base font-bold text-white">
                    {preview.dynamicTdee.toLocaleString()} kcal
                  </div>
                </div>
                <div className="col-span-2 min-w-0 rounded-xl border border-white/10 bg-[#0A0C10]/85 px-3 py-2.5 sm:col-span-1">
                  <div className="text-[11px] text-slate-400">Resting BMR</div>
                  <div className="tabular-nums mt-0.5 text-base font-bold text-slate-200">
                    {preview.bmr.toLocaleString()} kcal
                  </div>
                </div>
              </div>

              <div className="mt-2.5 grid grid-cols-3 gap-2">
                <div className="min-w-0 rounded-xl border border-[#2EE6A6]/25 bg-[#2EE6A6]/10 px-2.5 py-2 text-center sm:px-3">
                  <div className="text-[10px] font-semibold uppercase text-[#2EE6A6]">Protein</div>
                  <div className="tabular-nums text-sm font-bold text-white">
                    {preview.proteinG}g
                  </div>
                </div>
                <div className="min-w-0 rounded-xl border border-[#38BDF8]/25 bg-[#38BDF8]/10 px-2.5 py-2 text-center sm:px-3">
                  <div className="text-[10px] font-semibold uppercase text-[#38BDF8]">Carbs</div>
                  <div className="tabular-nums text-sm font-bold text-white">{preview.carbsG}g</div>
                </div>
                <div className="min-w-0 rounded-xl border border-[#FBBF24]/25 bg-[#FBBF24]/10 px-2.5 py-2 text-center sm:px-3">
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
              <span className="min-w-0 flex-1 break-words">{error}</span>
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
