import type { SyncStatusDTO } from './schemas';

export type Sex = 'male' | 'female' | 'other';
export type GoalType = 'CUT' | 'MAINTAIN' | 'BULK';
export type BmrFormula = 'katch_mcardle' | 'mifflin_st_jeor';
export type ReadinessStatus = 'optimal' | 'moderate' | 'overload';
export type WorkoutCategory = 'strength' | 'cardio' | 'hiit' | 'mobility' | 'sport';
export type WorkoutIntensity = 'low' | 'moderate' | 'high';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'supplement';
export type NutritionLogSource = 'MANUAL' | 'AI_TEXT' | 'AI_IMAGE';
export type NutritionConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface SupplementConfig {
  key: string;
  name: string;
  dosage: string;
  timing: string;
}

export interface SupplementStatusDTO extends SupplementConfig {
  taken: boolean;
}

export interface UserProfileDTO {
  id: string;
  name: string;
  sex: Sex;
  birthDate: string;
  age: number;
  heightCm: number;
  baselineActivityMultiplier: number;
  supplementStack: SupplementConfig[];
  webhookKeyPrefix?: string | null;
}

export interface UserGoalDTO {
  id: string;
  userId: string;
  goalType: GoalType;
  calorieAdjustment: number;
  proteinPerKg: number;
  fatRatio: number;
  isActive: boolean;
}

export interface BodyMetricDTO {
  id: string;
  userId: string;
  recordedDate: string;
  weightKg: number;
  bodyFatPct: number | null;
  skeletalMuscleMassKg: number | null;
  restingHr?: number | null;
  sleepHours?: number | null;
  notes: string | null;
}

export interface WorkoutLogDTO {
  id: string;
  userId: string;
  loggedDate: string;
  activityName: string;
  category: WorkoutCategory;
  durationMin: number;
  activeCalories: number;
  intensity: WorkoutIntensity;
  activityType?: string;
  loggedAt: string;
}

export interface NutritionLogDTO {
  id: string;
  userId: string;
  loggedDate: string;
  mealType: MealType;
  itemName: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  supplementKey: string | null;
  source?: NutritionLogSource;
  loggedAt: string;
}

export interface MacroProgress {
  consumed: number;
  target: number;
  remaining: number;
  percentage: number;
}

export interface MacroBreakdown {
  protein: MacroProgress;
  carbs: MacroProgress;
  fat: MacroProgress;
}

export interface EnergySummary {
  bmr: number;
  bmrFormula: BmrFormula;
  leanBodyMassKg: number | null;
  baselineTdee: number;
  activeCalories: number;
  dynamicTdee: number;
  calorieAdjustment: number;
  targetCalories: number;
  consumedCalories: number;
  remainingCalories: number;
  intakePercentage: number;
}

export interface ReadinessSummary {
  status: ReadinessStatus;
  score: number;
  badge: string;
  headline: string;
  summary: string;
  calorieAdherencePct: number;
  proteinAdherencePct: number;
  trainingLoadLevel: 'rest' | 'light' | 'moderate' | 'high';
}

export interface DashboardTodayResponse {
  date: string;
  storageMode: 'postgres' | 'memory';
  profile: UserProfileDTO;
  goal: UserGoalDTO;
  latestMetric: BodyMetricDTO;
  energy: EnergySummary;
  macros: MacroBreakdown;
  readiness: ReadinessSummary;
  workouts: WorkoutLogDTO[];
  meals: NutritionLogDTO[];
  supplements: SupplementStatusDTO[];
}

export interface BodyTrendPoint {
  date: string;
  weightKg: number;
  weightMa7: number;
  bodyFatPct: number | null;
  skeletalMuscleMassKg: number | null;
}

export interface BodyTrendSummary {
  startWeightKg: number;
  currentWeightKg: number;
  weightDeltaKg: number;
  startBodyFatPct: number | null;
  currentBodyFatPct: number | null;
  bodyFatDeltaPct: number | null;
  startMuscleKg: number | null;
  currentMuscleKg: number | null;
  muscleDeltaKg: number | null;
}

export interface MetricsTrendsResponse {
  days: number;
  points: BodyTrendPoint[];
  summary: BodyTrendSummary;
}

export type SyncStatus = 'SUCCESS' | 'NEVER';

export interface AppleHealthWebhookResponse {
  ok: true;
  recorded_date: string;
  updated_fields: string[];
  dynamic_tdee: number;
  target_calories: number;
  synced_at: string;
}

export interface WebhookKeyStatusDTO {
  configured: boolean;
  masked_key: string | null;
  prefix: string | null;
}

export interface MeResponseDTO {
  userId: string;
  email: string | null;
  onboarded: boolean;
  profile: UserProfileDTO | null;
  goal: UserGoalDTO | null;
  webhookKey: WebhookKeyStatusDTO;
}

export type CalendarDayStatus = 'optimal' | 'moderate' | 'overload' | 'empty';

export interface CalendarDaySummaryDTO {
  date: string;
  hasData: boolean;
  status: CalendarDayStatus;
  consumedCalories: number;
  targetCalories: number;
  dynamicTdee: number;
  activeCalories: number;
  proteinG: number;
  proteinTargetG: number;
  carbsG: number;
  fatG: number;
  mealCount: number;
  workoutCount: number;
  supplementsTaken: number;
  supplementsTotal: number;
  weightKg: number | null;
  bodyFatPct: number | null;
  sleepHours: number | null;
  restingHr: number | null;
}

export interface MonthlyCalendarSummaryDTO {
  loggedDays: number;
  optimalDays: number;
  moderateDays: number;
  overloadDays: number;
  avgCalories: number;
  avgProteinG: number;
  totalActiveCalories: number;
  avgWeightKg: number | null;
  supplementAdherencePct: number;
}

export interface MonthlyCalendarResponse {
  month: string;
  daysInMonth: number;
  today: string;
  days: CalendarDaySummaryDTO[];
  summary: MonthlyCalendarSummaryDTO;
}

export interface DashboardBootstrapResponse {
  me: MeResponseDTO;
  dashboard: DashboardTodayResponse | null;
  trends: MetricsTrendsResponse | null;
  syncStatus: SyncStatusDTO;
}

export interface UpdateSupplementsResponse {
  supplementStack: SupplementConfig[];
}
