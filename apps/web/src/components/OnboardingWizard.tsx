import { useMemo, useState, type FormEvent } from 'react';
import {
  OnboardingProfileSchema,
  type GoalType,
  type Sex,
  type TdeeMode,
} from '@health-dash/shared';
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  Flame,
  Gauge,
  Loader2,
  LogOut,
  Scale,
  Sparkles,
  Target,
  User,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { submitOnboarding } from '../lib/api';

const TDEE_MODE_OPTIONS: Array<{
  value: TdeeMode;
  title: string;
  badge: string;
  defaultMultiplier: number;
  description: string;
}> = [
  {
    value: 'APPLE_HEALTH_DYNAMIC',
    title: 'Apple Health Dynamic',
    badge: 'Watch All-Day',
    defaultMultiplier: 1.1,
    description: 'ฐาน 1.1× (BMR + ย่อยอาหาร) + บวก Active Energy จาก Apple Watch ทั้งวัน (ไม่นับซ้ำ NEAT)',
  },
  {
    value: 'MANUAL_WORKOUT_DYNAMIC',
    title: 'Workout Dynamic',
    badge: 'Manual Log',
    defaultMultiplier: 1.25,
    description: 'ฐาน NEAT 1.2–1.3× (ชีวิตประจำวัน) + บวกเฉพาะ Workout kcal ที่บันทึก',
  },
  {
    value: 'FIXED_STATIC',
    title: 'Fixed Static TDEE',
    badge: 'Constant',
    defaultMultiplier: 1.55,
    description: 'ใช้ตัวคูณเฉลี่ยรวมการซ้อมทั้งสัปดาห์ เป้าแคลอรีคงที่ ไม่บวก Active รายวันเพิ่ม',
  },
];

const ACTIVITY_OPTIONS_BY_MODE: Record<
  TdeeMode,
  Array<{ value: number; title: string; subtitle: string }>
> = {
  APPLE_HEALTH_DYNAMIC: [
    { value: 1.0, title: '1.0× BMR Only', subtitle: 'Watch counts 100% of daily steps + workouts' },
    { value: 1.1, title: '1.1× BMR + TEF', subtitle: 'Recommended when syncing Apple Watch Active Energy' },
    { value: 1.15, title: '1.15× Light Base', subtitle: 'Desk day with partial Apple Watch wear' },
    { value: 1.2, title: '1.2× Active Base', subtitle: 'Active job + partial watch tracking' },
  ],
  MANUAL_WORKOUT_DYNAMIC: [
    { value: 1.2, title: '1.2× Sedentary NEAT', subtitle: 'Desk work, low daily steps (excl. workouts)' },
    { value: 1.25, title: '1.25× Light NEAT', subtitle: 'Office routine + 5k–7k steps (excl. workouts)' },
    { value: 1.3, title: '1.3× Moderate NEAT', subtitle: 'Active daily steps 8k+ (excl. workouts)' },
    { value: 1.4, title: '1.4× Physical NEAT', subtitle: 'On-your-feet daily work (excl. workouts)' },
  ],
  FIXED_STATIC: [
    { value: 1.2, title: '1.2× Sedentary', subtitle: 'Minimal structured training' },
    { value: 1.35, title: '1.35× Light', subtitle: '1–3 workouts/week included in baseline' },
    { value: 1.55, title: '1.55× Moderate', subtitle: '3–5 workouts/week included in baseline' },
    { value: 1.725, title: '1.725× High', subtitle: '6–7 workouts/week or endurance volume' },
  ],
};

const GOAL_OPTIONS: Array<{
  value: GoalType;
  title: string;
  adjustment: number;
  badge: string;
  description: string;
  accentClass: string;
}> = [
  {
    value: 'CUT',
    title: 'CUT',
    adjustment: -350,
    badge: '-350 kcal',
    description: 'Sustainable fat loss while preserving lean mass',
    accentClass: 'border-[#2EE6A6]/40 bg-[#2EE6A6]/12 text-[#2EE6A6]',
  },
  {
    value: 'MAINTAIN',
    title: 'MAINTAIN',
    adjustment: 0,
    badge: '0 kcal',
    description: 'Body recomposition & athletic performance balance',
    accentClass: 'border-[#FFB020]/40 bg-[#FFB020]/12 text-[#FFB020]',
  },
  {
    value: 'BULK',
    title: 'BULK',
    adjustment: 300,
    badge: '+300 kcal',
    description: 'Controlled lean hypertrophy surplus',
    accentClass: 'border-[#38BDF8]/40 bg-[#38BDF8]/12 text-[#38BDF8]',
  },
];

function deriveDefaultName(
  fullName: unknown,
  email: string | null | undefined,
): string {
  if (typeof fullName === 'string' && fullName.trim().length > 0) {
    return fullName.trim();
  }
  if (email && email.includes('@')) {
    const prefix = email.split('@')[0]?.replace(/[._-]+/g, ' ').trim();
    if (prefix) {
      return prefix.replace(/\b\w/g, (ch) => ch.toUpperCase());
    }
  }
  return '';
}

function calculatePreviewMetrics(params: {
  gender: Sex;
  birthDate: string;
  heightCm: string;
  weightKg: string;
  bodyFatPct: string;
  multiplier: number;
  calorieAdjustment: string;
}): { bmr: number; baselineTdee: number; targetCalories: number; formula: string } | null {
  const height = Number(params.heightCm);
  const weight = Number(params.weightKg);
  const adj = Number(params.calorieAdjustment);
  if (!Number.isFinite(height) || !Number.isFinite(weight) || height <= 0 || weight <= 0) {
    return null;
  }

  const bf = params.bodyFatPct.trim() !== '' ? Number(params.bodyFatPct) : null;
  let bmr = 0;
  let formula = 'Mifflin-St Jeor';

  if (bf !== null && Number.isFinite(bf) && bf >= 2 && bf <= 75) {
    const lbm = weight * (1 - bf / 100);
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
    const safeAge = Number.isFinite(age) && age > 0 && age < 120 ? age : 28;
    const sexOffset = params.gender === 'male' ? 5 : params.gender === 'female' ? -161 : -78;
    bmr = Math.round(10 * weight + 6.25 * height - 5 * safeAge + sexOffset);
  }

  const baselineTdee = Math.round(bmr * params.multiplier);
  const safeAdj = Number.isFinite(adj) ? Math.round(adj) : 0;
  const targetCalories = Math.max(1200, baselineTdee + safeAdj);

  return { bmr, baselineTdee, targetCalories, formula };
}

export function OnboardingWizard() {
  const { user, me, refreshMe, signOut } = useAuth();

  const initialName = useMemo(() => {
    const meta = user?.user_metadata as Record<string, unknown> | undefined;
    return deriveDefaultName(meta?.full_name ?? meta?.name, user?.email ?? me?.email);
  }, [user, me]);

  const [step, setStep] = useState<1 | 2 | 3>(1);

  // Step 1: Identity & Basics
  const [name, setName] = useState(initialName);
  const [gender, setGender] = useState<Sex>('male');
  const [birthDate, setBirthDate] = useState('1995-01-01');
  const [heightCm, setHeightCm] = useState('');

  // Step 2: Body Composition & Activity
  const [weightKg, setWeightKg] = useState('');
  const [bodyFatPct, setBodyFatPct] = useState('');
  const [skeletalMuscleKg, setSkeletalMuscleKg] = useState('');
  const [tdeeMode, setTdeeMode] = useState<TdeeMode>('MANUAL_WORKOUT_DYNAMIC');
  const [activityMultiplier, setActivityMultiplier] = useState<number>(1.25);

  // Step 3: Goal & Calorie Target
  const [goalType, setGoalType] = useState<GoalType>('CUT');
  const [calorieAdjustment, setCalorieAdjustment] = useState<string>('-350');

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const preview = useMemo(
    () =>
      calculatePreviewMetrics({
        gender,
        birthDate,
        heightCm,
        weightKg,
        bodyFatPct,
        multiplier: activityMultiplier,
        calorieAdjustment,
      }),
    [gender, birthDate, heightCm, weightKg, bodyFatPct, activityMultiplier, calorieAdjustment],
  );

  const handleNextStep = () => {
    setError(null);

    if (step === 1) {
      if (name.trim().length < 1) {
        setError('Please enter your display name.');
        return;
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
        setError('Please enter a valid birth date (YYYY-MM-DD).');
        return;
      }
      const parsedHeight = Number(heightCm);
      if (!heightCm.trim() || !Number.isFinite(parsedHeight) || parsedHeight < 80 || parsedHeight > 260) {
        setError('Please enter a valid height between 80 and 260 cm.');
        return;
      }
      setStep(2);
      return;
    }

    if (step === 2) {
      const parsedWeight = Number(weightKg);
      if (!weightKg.trim() || !Number.isFinite(parsedWeight) || parsedWeight < 20 || parsedWeight > 400) {
        setError('Please enter a valid body weight between 20 and 400 kg.');
        return;
      }
      if (bodyFatPct.trim() !== '') {
        const bf = Number(bodyFatPct);
        if (!Number.isFinite(bf) || bf < 2 || bf > 75) {
          setError('Body fat % must be between 2 and 75%.');
          return;
        }
      }
      if (skeletalMuscleKg.trim() !== '') {
        const smm = Number(skeletalMuscleKg);
        if (!Number.isFinite(smm) || smm < 5 || smm > 150) {
          setError('Skeletal muscle mass must be between 5 and 150 kg.');
          return;
        }
      }
      setStep(3);
    }
  };

  const handleSelectGoal = (option: (typeof GOAL_OPTIONS)[number]) => {
    setGoalType(option.value);
    setCalorieAdjustment(String(option.adjustment));
    setError(null);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsed = OnboardingProfileSchema.safeParse({
      name: name.trim() || undefined,
      gender,
      birth_date: birthDate,
      height_cm: heightCm,
      weight_kg: weightKg,
      body_fat_pct: bodyFatPct.trim() === '' ? undefined : bodyFatPct,
      skeletal_muscle_kg: skeletalMuscleKg.trim() === '' ? undefined : skeletalMuscleKg,
      baseline_activity_multiplier: activityMultiplier,
      tdee_mode: tdeeMode,
      goal_type: goalType,
      calorie_adjustment: calorieAdjustment,
    });

    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      setError(firstIssue?.message ?? 'Please review your onboarding details.');
      return;
    }

    setSubmitting(true);
    try {
      await submitOnboarding(parsed.data);
      await refreshMe();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save your biometric profile.');
    } finally {
      setSubmitting(false);
    }
  };

  const progressPct = step === 1 ? '33%' : step === 2 ? '67%' : '100%';

  return (
    <div className="relative min-h-screen overflow-x-clip bg-[#0A0C10] px-4 py-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))] text-white sm:px-6 sm:py-10">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 h-80 bg-[radial-gradient(ellipse_at_top,rgba(46,230,166,0.12),transparent_65%)]"
      />

      <div className="relative z-10 mx-auto w-full min-w-0 max-w-xl">
        {/* Top Bar with Account Switch / Sign Out */}
        <header className="mb-6 flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-[#2EE6A6]/30 bg-gradient-to-br from-[#2EE6A6]/20 to-[#38BDF8]/15">
              <Activity className="h-5 w-5 text-[#2EE6A6]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-bold tracking-tight text-white">VitalPulse</span>
                <span className="shrink-0 rounded-full border border-[#2EE6A6]/25 bg-[#2EE6A6]/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#2EE6A6]">
                  Setup
                </span>
              </div>
              {user?.email ? (
                <p className="truncate text-xs text-slate-400">{user.email}</p>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={() => void signOut()}
            className="inline-flex min-h-[44px] shrink-0 cursor-pointer items-center gap-1.5 rounded-2xl border border-white/10 bg-[#141720] px-3.5 py-2 text-xs font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sign Out</span>
          </button>
        </header>

        {/* Main Card */}
        <section className="relative min-w-0 overflow-hidden rounded-3xl border border-white/5 bg-[#141720] p-5 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.95)] sm:p-7">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
          />

          {/* Step Indicator */}
          <div className="mb-6 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="font-semibold uppercase tracking-wider text-[#2EE6A6]">
                Step {step} of 3
              </span>
              <span className="text-slate-400">
                {step === 1
                  ? 'Identity & Basics'
                  : step === 2
                    ? 'Body Composition & Activity'
                    : 'Goal & Calorie Target'}
              </span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#2EE6A6] to-[#38BDF8] transition-all duration-300"
                style={{ width: progressPct }}
              />
            </div>
          </div>

          <form onSubmit={(e) => void handleSubmit(e)} className="min-w-0 space-y-5">
            {step === 1 ? (
              <div className="min-w-0 space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#2EE6A6]/15 text-[#2EE6A6]">
                    <User className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-white">Identity &amp; Basics</h2>
                    <p className="text-xs text-slate-400">
                      Calibrates your baseline metabolic equation
                    </p>
                  </div>
                </div>

                <label className="block min-w-0">
                  <span className="text-xs font-medium text-slate-300">Display Name *</span>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Alex"
                    className="mt-1.5 min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-[#0A0C10] px-3.5 py-2 text-base text-white outline-none transition placeholder:text-slate-600 focus:border-[#2EE6A6] sm:text-sm"
                  />
                </label>

                <div>
                  <span className="text-xs font-medium text-slate-300">Gender *</span>
                  <div className="mt-1.5 grid grid-cols-3 gap-2">
                    {(['male', 'female', 'other'] as const).map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setGender(option)}
                        className={`min-h-[44px] min-w-0 cursor-pointer rounded-xl border px-2 py-2 text-sm font-semibold capitalize transition sm:px-3 ${
                          gender === option
                            ? 'border-[#2EE6A6]/60 bg-[#2EE6A6]/15 text-[#2EE6A6]'
                            : 'border-white/10 bg-[#0A0C10] text-slate-300 hover:bg-white/[0.04]'
                        }`}
                      >
                        {option}
                      </button>
                    ))}
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
                      className="mt-1.5 min-h-[44px] w-full min-w-0 max-w-full appearance-none rounded-xl border border-white/10 bg-[#0A0C10] px-3.5 py-2 text-base text-white outline-none transition focus:border-[#2EE6A6] sm:text-sm"
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
                      placeholder="176"
                      className="mt-1.5 min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-[#0A0C10] px-3.5 py-2 text-base tabular-nums text-white outline-none transition placeholder:text-slate-600 focus:border-[#2EE6A6] sm:text-sm"
                    />
                  </label>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="min-w-0 space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#38BDF8]/15 text-[#38BDF8]">
                    <Scale className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-white">
                      Body Composition &amp; Activity
                    </h2>
                    <p className="text-xs text-slate-400">
                      Establishes your starting metrics and baseline NEAT
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <label className="block min-w-0">
                    <span className="text-xs font-medium text-slate-300">Weight (kg) *</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min={20}
                      max={400}
                      required
                      value={weightKg}
                      onChange={(e) => setWeightKg(e.target.value)}
                      placeholder="74.5"
                      className="mt-1.5 min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-[#0A0C10] px-3.5 py-2 text-base tabular-nums text-white outline-none transition placeholder:text-slate-600 focus:border-[#38BDF8] sm:text-sm"
                    />
                  </label>

                  <label className="block min-w-0">
                    <span className="text-xs font-medium text-slate-300">Body Fat (%)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min={2}
                      max={75}
                      value={bodyFatPct}
                      onChange={(e) => setBodyFatPct(e.target.value)}
                      placeholder="Optional"
                      className="mt-1.5 min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-[#0A0C10] px-3.5 py-2 text-base tabular-nums text-white outline-none transition placeholder:text-slate-600 focus:border-[#FFB020] sm:text-sm"
                    />
                  </label>

                  <label className="block min-w-0">
                    <span className="text-xs font-medium text-slate-300">Muscle Mass (kg)</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min={5}
                      max={150}
                      value={skeletalMuscleKg}
                      onChange={(e) => setSkeletalMuscleKg(e.target.value)}
                      placeholder="Optional"
                      className="mt-1.5 min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-[#0A0C10] px-3.5 py-2 text-base tabular-nums text-white outline-none transition placeholder:text-slate-600 focus:border-[#2EE6A6] sm:text-sm"
                    />
                  </label>
                </div>

                <div className="flex items-start gap-2 rounded-2xl border border-[#38BDF8]/20 bg-[#38BDF8]/8 px-3.5 py-2.5 text-xs text-slate-300">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#38BDF8]" />
                  <span className="min-w-0 flex-1 break-words">
                    Adding Body Fat % automatically upgrades your BMR calculation from{' '}
                    <strong className="text-white">Mifflin-St Jeor</strong> to{' '}
                    <strong className="text-[#2EE6A6]">Katch-McArdle (LBM)</strong>.
                  </span>
                </div>

                <div className="space-y-3">
                  <div>
                    <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
                      <Gauge className="h-3.5 w-3.5 text-[#38BDF8]" />
                      TDEE Calculation Mode
                    </span>
                    <div className="mt-2 grid grid-cols-1 gap-2">
                      {TDEE_MODE_OPTIONS.map((modeOpt) => {
                        const active = tdeeMode === modeOpt.value;
                        return (
                          <button
                            key={modeOpt.value}
                            type="button"
                            onClick={() => {
                              setTdeeMode(modeOpt.value);
                              setActivityMultiplier(modeOpt.defaultMultiplier);
                            }}
                            className={`flex min-h-[44px] min-w-0 cursor-pointer flex-col items-start justify-center rounded-2xl border px-3.5 py-2.5 text-left transition ${
                              active
                                ? 'border-[#38BDF8]/60 bg-[#38BDF8]/12'
                                : 'border-white/10 bg-[#0A0C10] hover:bg-white/[0.04]'
                            }`}
                          >
                            <div className="flex w-full min-w-0 items-center justify-between gap-2">
                              <span
                                className={`min-w-0 text-xs font-semibold ${
                                  active ? 'text-[#38BDF8]' : 'text-white'
                                }`}
                              >
                                {modeOpt.title}
                              </span>
                              <span className="shrink-0 rounded-full border border-white/10 bg-black/30 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                                {modeOpt.badge}
                              </span>
                            </div>
                            <span className="mt-0.5 text-[11px] leading-snug text-slate-400">
                              {modeOpt.description}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <span className="text-xs font-medium text-slate-300">
                      Baseline Activity Multiplier
                    </span>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {ACTIVITY_OPTIONS_BY_MODE[tdeeMode].map((opt) => {
                        const active = activityMultiplier === opt.value;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setActivityMultiplier(opt.value)}
                            className={`flex min-h-[44px] min-w-0 cursor-pointer flex-col items-start justify-center rounded-2xl border px-3.5 py-2.5 text-left transition ${
                              active
                                ? 'border-[#2EE6A6]/60 bg-[#2EE6A6]/12'
                                : 'border-white/10 bg-[#0A0C10] hover:bg-white/[0.04]'
                            }`}
                          >
                            <div className="flex w-full min-w-0 items-center justify-between gap-2">
                              <span
                                className={`min-w-0 break-words text-xs font-semibold ${
                                  active ? 'text-[#2EE6A6]' : 'text-white'
                                }`}
                              >
                                {opt.title}
                              </span>
                              {active ? (
                                <Check className="h-3.5 w-3.5 shrink-0 text-[#2EE6A6]" />
                              ) : null}
                            </div>
                            <span className="mt-0.5 text-[11px] text-slate-400">{opt.subtitle}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="min-w-0 space-y-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-[#FFB020]/15 text-[#FFB020]">
                    <Target className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-white">Goal &amp; Calorie Target</h2>
                    <p className="text-xs text-slate-400">
                      Choose your recomposition phase and fine-tune daily offset
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {GOAL_OPTIONS.map((opt) => {
                    const active = goalType === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleSelectGoal(opt)}
                        className={`flex min-h-[44px] min-w-0 cursor-pointer flex-col items-start justify-between rounded-2xl border p-3.5 text-left transition ${
                          active
                            ? opt.accentClass
                            : 'border-white/10 bg-[#0A0C10] text-slate-300 hover:bg-white/[0.04]'
                        }`}
                      >
                        <div className="flex w-full items-center justify-between gap-2">
                          <span className="text-sm font-bold">{opt.title}</span>
                          <span className="tabular-nums shrink-0 rounded-full bg-black/30 px-2 py-0.5 text-[11px] font-semibold">
                            {opt.badge}
                          </span>
                        </div>
                        <span className="mt-1.5 text-[11px] leading-snug text-slate-400">
                          {opt.description}
                        </span>
                      </button>
                    );
                  })}
                </div>

                <label className="block min-w-0">
                  <span className="text-xs font-medium text-slate-300">
                    Daily Calorie Adjustment (kcal)
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="1"
                    min={-1500}
                    max={1500}
                    required
                    value={calorieAdjustment}
                    onChange={(e) => setCalorieAdjustment(e.target.value)}
                    className="mt-1.5 min-h-[44px] w-full min-w-0 max-w-full rounded-xl border border-white/10 bg-[#0A0C10] px-3.5 py-2 text-base tabular-nums text-white outline-none transition focus:border-[#2EE6A6] sm:text-sm"
                  />
                </label>

                {preview ? (
                  <div className="min-w-0 rounded-2xl border border-white/10 bg-[#0F131C]/90 p-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="flex items-center gap-1.5 font-medium text-slate-400">
                        <Flame className="h-3.5 w-3.5 shrink-0 text-[#FFB020]" />
                        <span>Engine Preview ({preview.formula})</span>
                      </span>
                      <span className="tabular-nums font-semibold text-[#2EE6A6]">
                        Target: {preview.targetCalories.toLocaleString()} kcal/day
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-400">
                      <div className="min-w-0 rounded-xl bg-[#0A0C10] px-3 py-2">
                        Resting BMR:{' '}
                        <strong className="tabular-nums text-white">
                          {preview.bmr.toLocaleString()} kcal
                        </strong>
                      </div>
                      <div className="min-w-0 rounded-xl bg-[#0A0C10] px-3 py-2">
                        Baseline TDEE:{' '}
                        <strong className="tabular-nums text-white">
                          {preview.baselineTdee.toLocaleString()} kcal
                        </strong>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {/* Validation / API Error Banner */}
            {error ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-2xl border border-[#FF5C6C]/30 bg-[#FF5C6C]/12 px-3.5 py-3 text-xs text-[#FF8A95]"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#FF5C6C]" />
                <span className="min-w-0 flex-1 break-words leading-relaxed font-medium">
                  {error}
                </span>
              </div>
            ) : null}

            {/* Footer Controls */}
            <div className="flex items-center justify-between gap-3 pt-2">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setStep((prev) => (prev === 3 ? 2 : 1));
                  }}
                  disabled={submitting}
                  className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:opacity-50"
                >
                  <ArrowLeft className="h-4 w-4" />
                  <span>Back</span>
                </button>
              ) : (
                <div />
              )}

              {step < 3 ? (
                <button
                  type="button"
                  onClick={handleNextStep}
                  className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#2EE6A6] px-5 py-2 text-sm font-bold text-[#081016] transition hover:brightness-110 active:scale-[0.99]"
                >
                  <span>Continue</span>
                  <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#2EE6A6] px-5 py-2 text-sm font-bold text-[#081016] shadow-[0_0_24px_rgba(46,230,166,0.22)] transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Setting Up…</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      <span>Complete Setup</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
