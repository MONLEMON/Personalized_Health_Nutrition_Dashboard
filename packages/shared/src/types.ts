import type { SyncStatusDTO } from './schemas';

export type Sex = 'male' | 'female' | 'other';
export type GoalType = 'CUT' | 'MAINTAIN' | 'BULK';
export type TdeeMode = 'APPLE_HEALTH_DYNAMIC' | 'MANUAL_WORKOUT_DYNAMIC' | 'FIXED_STATIC';
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
  tdeeMode?: TdeeMode;
  supplementStack: SupplementConfig[];
  webhookKeyPrefix?: string | null;
}

export type WeekdayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type CalorieCyclingMode = 'NONE' | 'TRAINING_REST' | 'WEEKEND_BUFFER' | 'CUSTOM';
export type CalorieCyclingDayType = 'high' | 'base' | 'low';

export interface CalorieCyclingConfig {
  enabled: boolean;
  mode: CalorieCyclingMode;
  dayOffsets: Record<WeekdayKey, number>;
  trainingDayOffset: number;
  restDayOffset: number;
  trainingDays: WeekdayKey[];
}

export interface UserGoalDTO {
  id: string;
  userId: string;
  goalType: GoalType;
  calorieAdjustment: number;
  proteinPerKg: number;
  fatRatio: number;
  isActive: boolean;
  calorieCycling?: CalorieCyclingConfig | null;
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
  effectiveActiveCalories?: number;
  tdeeMode?: TdeeMode;
  dynamicTdee: number;
  calorieAdjustment: number;
  cyclingOffset?: number;
  cyclingDayType?: CalorieCyclingDayType;
  cyclingLabel?: string | null;
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

export interface WeeklyBudgetDayDTO {
  date: string;
  weekday: WeekdayKey;
  dayLabel: string;
  dayType: CalorieCyclingDayType;
  cyclingOffset: number;
  targetCalories: number;
  consumedCalories: number;
  isToday: boolean;
  isFuture: boolean;
}

export interface WeeklyBudgetSummaryDTO {
  weekStartDate: string;
  weekEndDate: string;
  weeklyTargetCalories: number;
  weeklyConsumedCalories: number;
  weeklyRemainingCalories: number;
  daysElapsed: number;
  cyclingEnabled: boolean;
  cyclingMode: CalorieCyclingMode;
  days: WeeklyBudgetDayDTO[];
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
  weeklyBudget?: WeeklyBudgetSummaryDTO;
  hydration?: WaterLogSummaryDTO;
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
  waterMl?: number;
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

export type CoachAdjustmentDirection = 'INCREASE' | 'DECREASE' | 'MAINTAIN';

export type CoachRecommendationReasonCode =
  | 'ON_TRACK'
  | 'INSUFFICIENT_DATA'
  | 'CUT_TOO_SLOW'
  | 'CUT_TOO_FAST'
  | 'BULK_TOO_SLOW'
  | 'BULK_TOO_FAST'
  | 'MAINTAIN_GAINING'
  | 'MAINTAIN_LOSING';

export interface WeeklyCoachMetricsDTO {
  weekStartDate: string;
  weekEndDate: string;
  daysLogged: number;
  avgIntakeCalories: number;
  avgTargetCalories: number;
  avgProteinG: number;
  avgProteinTargetG: number;
  proteinAdherencePct: number;
  calorieAdherencePct: number;
  totalActiveCalories: number;
  workoutDays: number;
  supplementAdherencePct: number;
  weekdayAvgCalories: number | null;
  weekendAvgCalories: number | null;
  currentWeightMa7: number | null;
  previousWeightMa7: number | null;
  weightDeltaKg: number | null;
  weightDeltaPct: number | null;
  observedTdee: number | null;
  estimatedTdee: number;
  avgSleepHours: number | null;
  avgRestingHr: number | null;
}

export interface WeeklyCoachRecommendationDTO {
  direction: CoachAdjustmentDirection;
  deltaKcal: number;
  currentCalorieAdjustment: number;
  suggestedCalorieAdjustment: number;
  reasonCode: CoachRecommendationReasonCode;
  canApply: boolean;
}

export interface WeeklyCoachAiNarrativeDTO {
  weeklyScore: number;
  headline: string;
  summary: string;
  wins: string[];
  bottlenecks: string[];
  actionPlan: string[];
  adjustmentRationale: string;
  source: 'GEMINI' | 'DETERMINISTIC_FALLBACK';
}

export interface WeeklyCoachReportDTO {
  id: string;
  userId: string;
  weekStartDate: string;
  weekEndDate: string;
  metrics: WeeklyCoachMetricsDTO;
  recommendation: WeeklyCoachRecommendationDTO;
  narrative: WeeklyCoachAiNarrativeDTO;
  appliedAt: string | null;
  generatedAt: string;
}

export interface WeeklyCoachStatusResponse {
  report: WeeklyCoachReportDTO | null;
  liveMetrics: WeeklyCoachMetricsDTO;
  liveRecommendation: WeeklyCoachRecommendationDTO;
}

export interface ApplyWeeklyCoachResponse {
  report: WeeklyCoachReportDTO;
  me: MeResponseDTO;
}

export type LoggableMealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export interface SavedMealDTO {
  id: string;
  userId: string;
  name: string;
  defaultMealType: LoggableMealType;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  servingNote: string | null;
  usageCount: number;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface RecentMealSuggestionDTO {
  itemName: string;
  mealType: LoggableMealType;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  lastLoggedDate: string;
  logCount: number;
}

export interface SavedMealsListResponse {
  savedMeals: SavedMealDTO[];
  recentMeals: RecentMealSuggestionDTO[];
}

export interface LogSavedMealResponse {
  meal: NutritionLogDTO;
  savedMeal: SavedMealDTO;
}

export interface CopyYesterdayMealsResponse {
  copiedCount: number;
  sourceDate: string;
  targetDate: string;
  items: NutritionLogDTO[];
}

export interface HydrationEntryDTO {
  id: string;
  amountMl: number;
  loggedAt: string;
}

export interface WaterLogSummaryDTO {
  date: string;
  consumedMl: number;
  targetMl: number;
  remainingMl: number;
  percentage: number;
  breakdown: {
    baseMl: number;
    workoutBonusMl: number;
    creatineBonusMl: number;
  };
  entries: HydrationEntryDTO[];
}
