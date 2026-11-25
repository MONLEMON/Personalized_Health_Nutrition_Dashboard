import type {
  BodyMetricDTO,
  BodyTrendPoint,
  DashboardTodayResponse,
  MetricsTrendsResponse,
} from '@health-dash/shared';

function formatLocalDate(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const TODAY = formatLocalDate(0);

const MOCK_LATEST_METRIC: BodyMetricDTO = {
  id: 'metric-today',
  userId: 'user-thanawat',
  recordedDate: TODAY,
  weightKg: 74.9,
  bodyFatPct: 16.5,
  skeletalMuscleMassKg: 35.6,
  notes: 'Morning fasted check-in',
};

export const mockDashboardToday: DashboardTodayResponse = {
  date: TODAY,
  storageMode: 'memory',
  profile: {
    id: 'user-thanawat',
    name: 'Thanawat K.',
    sex: 'male',
    birthDate: '1995-04-12',
    age: 31,
    heightCm: 176,
    baselineActivityMultiplier: 1.35,
    supplementStack: [
      {
        key: 'creatine',
        name: 'Creatine Monohydrate',
        dosage: '5 g',
        timing: 'Post-workout',
      },
      {
        key: 'vit_d3k2',
        name: 'Vitamin D3 + K2',
        dosage: '4000 IU',
        timing: 'With breakfast',
      },
      {
        key: 'omega3',
        name: 'Omega-3 EPA/DHA',
        dosage: '2 g',
        timing: 'With lunch',
      },
      {
        key: 'magnesium',
        name: 'Magnesium Glycinate',
        dosage: '400 mg',
        timing: 'Before sleep',
      },
      {
        key: 'electrolytes',
        name: 'Electrolytes',
        dosage: '1 sachet',
        timing: 'Intra-workout',
      },
    ],
  },
  goal: {
    id: 'goal-cut-1',
    userId: 'user-thanawat',
    goalType: 'CUT',
    calorieAdjustment: -350,
    proteinPerKg: 2.0,
    fatRatio: 0.25,
    isActive: true,
  },
  latestMetric: MOCK_LATEST_METRIC,
  energy: {
    bmr: 1721,
    bmrFormula: 'katch_mcardle',
    leanBodyMassKg: 62.5,
    baselineTdee: 2323,
    activeCalories: 510,
    dynamicTdee: 2833,
    calorieAdjustment: -350,
    targetCalories: 2483,
    consumedCalories: 1740,
    remainingCalories: 743,
    intakePercentage: 70,
  },
  macros: {
    protein: {
      consumed: 124,
      target: 150,
      remaining: 26,
      percentage: 83,
    },
    carbs: {
      consumed: 192,
      target: 316,
      remaining: 124,
      percentage: 61,
    },
    fat: {
      consumed: 48,
      target: 69,
      remaining: 21,
      percentage: 70,
    },
  },
  readiness: {
    status: 'optimal',
    score: 88,
    badge: 'Optimal Balance',
    headline: 'Primed for lean cut recovery',
    summary: 'Protein is at 83% of target with 743 kcal remaining after +510 kcal active burn.',
    calorieAdherencePct: 70,
    proteinAdherencePct: 83,
    trainingLoadLevel: 'moderate',
  },
  workouts: [
    {
      id: 'workout-1',
      userId: 'user-thanawat',
      loggedDate: TODAY,
      activityName: 'Upper Body Hypertrophy',
      category: 'strength',
      durationMin: 52,
      activeCalories: 290,
      intensity: 'high',
      loggedAt: `${TODAY}T07:30:00.000Z`,
    },
    {
      id: 'workout-2',
      userId: 'user-thanawat',
      loggedDate: TODAY,
      activityName: 'Zone 2 Treadmill Run',
      category: 'cardio',
      durationMin: 26,
      activeCalories: 220,
      intensity: 'moderate',
      loggedAt: `${TODAY}T08:30:00.000Z`,
    },
  ],
  meals: [
    {
      id: 'meal-1',
      userId: 'user-thanawat',
      loggedDate: TODAY,
      mealType: 'breakfast',
      itemName: 'Egg Whites, Oats & Blueberries',
      calories: 520,
      proteinG: 38,
      carbsG: 64,
      fatG: 12,
      supplementKey: null,
      loggedAt: `${TODAY}T09:15:00.000Z`,
    },
    {
      id: 'meal-2',
      userId: 'user-thanawat',
      loggedDate: TODAY,
      mealType: 'lunch',
      itemName: 'Grilled Chicken Riceberry Bowl',
      calories: 780,
      proteinG: 54,
      carbsG: 92,
      fatG: 20,
      supplementKey: null,
      loggedAt: `${TODAY}T12:45:00.000Z`,
    },
    {
      id: 'meal-3',
      userId: 'user-thanawat',
      loggedDate: TODAY,
      mealType: 'snack',
      itemName: 'Whey Isolate & Banana Shake',
      calories: 440,
      proteinG: 32,
      carbsG: 36,
      fatG: 16,
      supplementKey: null,
      loggedAt: `${TODAY}T16:10:00.000Z`,
    },
  ],
  supplements: [
    {
      key: 'creatine',
      name: 'Creatine Monohydrate',
      dosage: '5 g',
      timing: 'Post-workout',
      taken: true,
    },
    {
      key: 'vit_d3k2',
      name: 'Vitamin D3 + K2',
      dosage: '4000 IU',
      timing: 'With breakfast',
      taken: true,
    },
    {
      key: 'omega3',
      name: 'Omega-3 EPA/DHA',
      dosage: '2 g',
      timing: 'With lunch',
      taken: true,
    },
    {
      key: 'magnesium',
      name: 'Magnesium Glycinate',
      dosage: '400 mg',
      timing: 'Before sleep',
      taken: false,
    },
    {
      key: 'electrolytes',
      name: 'Electrolytes',
      dosage: '1 sachet',
      timing: 'Intra-workout',
      taken: false,
    },
  ],
};

function round1(val: number): number {
  return Math.round(val * 10) / 10;
}

export function getMockMetricsTrends(days = 30): MetricsTrendsResponse {
  const clampedDays = Math.max(7, Math.min(90, days));
  const points: BodyTrendPoint[] = [];

  for (let i = clampedDays - 1; i >= 0; i--) {
    const progress = (clampedDays - 1 - i) / Math.max(1, clampedDays - 1);
    const wave = Math.sin(i * 0.65) * 0.28 + Math.cos(i * 1.1) * 0.12;
    const startWeight = clampedDays >= 60 ? 78.1 : 76.8;
    const startFat = clampedDays >= 60 ? 19.6 : 18.4;
    const startMuscle = clampedDays >= 60 ? 34.8 : 35.1;

    const weightKg = round1(startWeight + (74.9 - startWeight) * progress + wave);
    const bodyFatPct = round1(startFat + (16.5 - startFat) * progress + wave * 0.25);
    const skeletalMuscleMassKg = round1(startMuscle + (35.6 - startMuscle) * progress - wave * 0.1);

    points.push({
      date: formatLocalDate(-i),
      weightKg,
      weightMa7: weightKg,
      bodyFatPct,
      skeletalMuscleMassKg,
    });
  }

  for (let i = 0; i < points.length; i++) {
    const windowStart = Math.max(0, i - 6);
    const slice = points.slice(windowStart, i + 1);
    const avg = slice.reduce((sum, p) => sum + p.weightKg, 0) / slice.length;
    points[i].weightMa7 = round1(avg);
  }

  const first = points[0];
  const last = points[points.length - 1];

  return {
    days: clampedDays,
    points,
    summary: {
      startWeightKg: first.weightKg,
      currentWeightKg: last.weightKg,
      weightDeltaKg: round1(last.weightKg - first.weightKg),
      startBodyFatPct: first.bodyFatPct,
      currentBodyFatPct: last.bodyFatPct,
      bodyFatDeltaPct:
        first.bodyFatPct !== null && last.bodyFatPct !== null
          ? round1(last.bodyFatPct - first.bodyFatPct)
          : null,
      startMuscleKg: first.skeletalMuscleMassKg,
      currentMuscleKg: last.skeletalMuscleMassKg,
      muscleDeltaKg:
        first.skeletalMuscleMassKg !== null && last.skeletalMuscleMassKg !== null
          ? round1(last.skeletalMuscleMassKg - first.skeletalMuscleMassKg)
          : null,
    },
  };
}

export const mockMetricsTrends: MetricsTrendsResponse = getMockMetricsTrends(30);
