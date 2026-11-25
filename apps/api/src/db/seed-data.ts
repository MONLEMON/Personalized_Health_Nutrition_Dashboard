import type {
  BodyMetricDTO,
  NutritionLogDTO,
  SupplementConfig,
  UserGoalDTO,
  UserProfileDTO,
  WorkoutLogDTO,
} from '@health-dash/shared';
import { calculateAge } from '../services/tdee.service';

export const SEED_USER_ID = '11111111-1111-4111-8111-111111111111';
export const SEED_GOAL_ID = '22222222-2222-4222-8222-222222222222';

const DEFAULT_APP_TIMEZONE = process.env.APP_TIMEZONE?.trim() || 'Asia/Bangkok';

const appDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: DEFAULT_APP_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Formats a Date into YYYY-MM-DD in the configured app timezone (default Asia/Bangkok, UTC+7).
 */
export function getLocalDateString(date: Date = new Date()): string {
  return appDateFormatter.format(date);
}

/**
 * Shifts a YYYY-MM-DD date string by deltaDays in calendar time (timezone-independent).
 */
export function shiftDateString(dateStr: string, deltaDays: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

export interface SeedDataset {
  today: string;
  profile: UserProfileDTO;
  goal: UserGoalDTO;
  bodyMetrics: BodyMetricDTO[];
  workoutLogs: WorkoutLogDTO[];
  nutritionLogs: NutritionLogDTO[];
}

export const DEFAULT_SUPPLEMENT_STACK: SupplementConfig[] = [
  { key: 'creatine', name: 'Creatine Monohydrate', dosage: '5g', timing: 'Post-workout' },
  { key: 'vit_d3k2', name: 'Vitamin D3 + K2', dosage: '4000 IU', timing: 'With breakfast' },
  { key: 'omega3', name: 'Omega-3 EPA/DHA', dosage: '2g', timing: 'With lunch' },
  { key: 'magnesium', name: 'Magnesium Glycinate', dosage: '400mg', timing: 'Before bed' },
  { key: 'electrolytes', name: 'Electrolytes', dosage: '1 packet', timing: 'During training' },
];

/**
 * Generates a deterministic 30-day realistic body recomposition, workout,
 * nutrition, and supplement dataset ending on the provided local YYYY-MM-DD date.
 */
export function createSeedDataset(todayDate: string = getLocalDateString()): SeedDataset {
  const birthDate = '1995-04-12';
  const profile: UserProfileDTO = {
    id: SEED_USER_ID,
    name: 'Thanawat K.',
    sex: 'male',
    birthDate,
    age: calculateAge(birthDate, todayDate),
    heightCm: 176,
    baselineActivityMultiplier: 1.35,
    supplementStack: DEFAULT_SUPPLEMENT_STACK.map((s) => ({ ...s })),
  };

  const goal: UserGoalDTO = {
    id: SEED_GOAL_ID,
    userId: SEED_USER_ID,
    goalType: 'CUT',
    calorieAdjustment: -350,
    proteinPerKg: 2.0,
    fatRatio: 0.25,
    isActive: true,
  };

  // 30 daily body metrics from day -29 to day 0 (today)
  // Weight: ~76.8 -> ~74.9 kg with realistic +/-0.4 kg fluctuations
  // Body fat: ~18.4% -> ~16.5%, Skeletal muscle mass: ~35.1 -> ~35.6 kg
  const bodyMetrics: BodyMetricDTO[] = [];
  const totalDays = 30;

  for (let i = 0; i < totalDays; i++) {
    const progress = i / (totalDays - 1);
    const recordedDate = shiftDateString(todayDate, i - (totalDays - 1));
    const isToday = i === totalDays - 1;

    const weightTrend = 76.8 - 1.9 * progress;
    const weightWave = isToday
      ? 0
      : 0.24 * Math.sin(i * 1.15) + 0.14 * Math.cos(i * 0.65);
    const weightKg = roundTo(weightTrend + weightWave, 1);

    const bfTrend = 18.4 - 1.9 * progress;
    const bfWave = isToday ? 0 : 0.12 * Math.sin(i * 0.85);
    const bodyFatPct = roundTo(bfTrend + bfWave, 1);

    const muscleTrend = 35.1 + 0.5 * progress;
    const muscleWave = isToday ? 0 : 0.08 * Math.cos(i * 0.9);
    const skeletalMuscleMassKg = roundTo(muscleTrend + muscleWave, 1);

    bodyMetrics.push({
      id: `metric-${String(i + 1).padStart(2, '0')}`,
      userId: SEED_USER_ID,
      recordedDate,
      weightKg,
      bodyFatPct,
      skeletalMuscleMassKg,
      notes: isToday
        ? 'Morning fasted weigh-in'
        : i === 0
          ? 'Baseline cut start'
          : null,
    });
  }

  // Deterministic workout schedule across the 30 days, ending with 2 sessions today
  const workoutTemplates: Array<{
    activityName: string;
    category: WorkoutLogDTO['category'];
    durationMin: number;
    activeCalories: number;
    intensity: WorkoutLogDTO['intensity'];
  }> = [
    {
      activityName: 'Strength Upper Body',
      category: 'strength',
      durationMin: 55,
      activeCalories: 360,
      intensity: 'high',
    },
    {
      activityName: 'Zone 2 Run',
      category: 'cardio',
      durationMin: 40,
      activeCalories: 320,
      intensity: 'moderate',
    },
    {
      activityName: 'Lower Body Hypertrophy',
      category: 'strength',
      durationMin: 60,
      activeCalories: 410,
      intensity: 'high',
    },
    {
      activityName: 'Mobility & Core Flow',
      category: 'mobility',
      durationMin: 30,
      activeCalories: 130,
      intensity: 'low',
    },
    {
      activityName: 'Metcon Intervals',
      category: 'hiit',
      durationMin: 35,
      activeCalories: 390,
      intensity: 'high',
    },
  ];

  const workoutLogs: WorkoutLogDTO[] = [];
  let workoutSeq = 1;

  for (let i = 0; i < totalDays - 1; i++) {
    const loggedDate = shiftDateString(todayDate, i - (totalDays - 1));
    // Train 5 days out of 7 (skip indices mod 7 === 2 or 6)
    const dayMod = i % 7;
    if (dayMod === 2 || dayMod === 6) {
      continue;
    }

    const template = workoutTemplates[i % workoutTemplates.length];
    workoutLogs.push({
      id: `workout-${String(workoutSeq++).padStart(2, '0')}`,
      userId: SEED_USER_ID,
      loggedDate,
      activityName: template.activityName,
      category: template.category,
      durationMin: template.durationMin,
      activeCalories: template.activeCalories,
      intensity: template.intensity,
      loggedAt: `${loggedDate}T07:30:00.000Z`,
    });
  }

  // Today's workouts (2 realistic sessions)
  workoutLogs.push(
    {
      id: `workout-${String(workoutSeq++).padStart(2, '0')}`,
      userId: SEED_USER_ID,
      loggedDate: todayDate,
      activityName: 'Strength Upper Body',
      category: 'strength',
      durationMin: 50,
      activeCalories: 340,
      intensity: 'high',
      loggedAt: `${todayDate}T07:15:00.000Z`,
    },
    {
      id: `workout-${String(workoutSeq++).padStart(2, '0')}`,
      userId: SEED_USER_ID,
      loggedDate: todayDate,
      activityName: 'Zone 2 Run',
      category: 'cardio',
      durationMin: 35,
      activeCalories: 290,
      intensity: 'moderate',
      loggedAt: `${todayDate}T12:15:00.000Z`,
    },
  );

  // Today's meals (breakfast + lunch) and 3 of 5 supplements checked
  const nutritionLogs: NutritionLogDTO[] = [
    {
      id: 'nutrition-today-01',
      userId: SEED_USER_ID,
      loggedDate: todayDate,
      mealType: 'breakfast',
      itemName: 'Protein Oats & Whey Berry Bowl',
      calories: 560,
      proteinG: 46,
      carbsG: 62,
      fatG: 13,
      supplementKey: null,
      loggedAt: `${todayDate}T08:15:00.000Z`,
    },
    {
      id: 'nutrition-today-02',
      userId: SEED_USER_ID,
      loggedDate: todayDate,
      mealType: 'lunch',
      itemName: 'Grilled Chicken & Jasmine Rice Bowl',
      calories: 740,
      proteinG: 58,
      carbsG: 78,
      fatG: 20,
      supplementKey: null,
      loggedAt: `${todayDate}T13:10:00.000Z`,
    },
    {
      id: 'nutrition-supp-creatine',
      userId: SEED_USER_ID,
      loggedDate: todayDate,
      mealType: 'supplement',
      itemName: 'Creatine Monohydrate',
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      supplementKey: 'creatine',
      loggedAt: `${todayDate}T08:20:00.000Z`,
    },
    {
      id: 'nutrition-supp-vit_d3k2',
      userId: SEED_USER_ID,
      loggedDate: todayDate,
      mealType: 'supplement',
      itemName: 'Vitamin D3 + K2',
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      supplementKey: 'vit_d3k2',
      loggedAt: `${todayDate}T08:20:00.000Z`,
    },
    {
      id: 'nutrition-supp-omega3',
      userId: SEED_USER_ID,
      loggedDate: todayDate,
      mealType: 'supplement',
      itemName: 'Omega-3 EPA/DHA',
      calories: 0,
      proteinG: 0,
      carbsG: 0,
      fatG: 0,
      supplementKey: 'omega3',
      loggedAt: `${todayDate}T13:15:00.000Z`,
    },
  ];

  return {
    today: todayDate,
    profile,
    goal,
    bodyMetrics,
    workoutLogs,
    nutritionLogs,
  };
}
