import { z } from 'zod';

const isoDateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const createNutritionLogSchema = z.object({
  itemName: z.string().trim().min(1, 'Item name is required').max(120),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  calories: z.coerce.number().min(0).max(10000),
  proteinG: z.coerce.number().min(0).max(1000),
  carbsG: z.coerce.number().min(0).max(1500),
  fatG: z.coerce.number().min(0).max(1000),
  loggedDate: z.string().regex(isoDateRegex, 'Expected YYYY-MM-DD').optional(),
});

export const createWorkoutLogSchema = z.object({
  activityName: z.string().trim().min(1, 'Activity name is required').max(120),
  category: z.enum(['strength', 'cardio', 'hiit', 'mobility', 'sport']),
  durationMin: z.coerce.number().int().min(1).max(1440),
  activeCalories: z.coerce.number().min(0).max(10000),
  intensity: z.enum(['low', 'moderate', 'high']),
  loggedDate: z.string().regex(isoDateRegex, 'Expected YYYY-MM-DD').optional(),
});

export const toggleSupplementSchema = z.object({
  supplementKey: z.string().trim().min(1, 'Supplement key is required').max(64),
  loggedDate: z.string().regex(isoDateRegex, 'Expected YYYY-MM-DD').optional(),
});

export const createBodyMetricSchema = z.object({
  weightKg: z.coerce.number().positive().min(20).max(400),
  bodyFatPct: z.coerce.number().min(2).max(75).nullable().optional(),
  skeletalMuscleMassKg: z.coerce.number().min(5).max(150).nullable().optional(),
  notes: z.string().trim().max(300).nullable().optional(),
  recordedDate: z.string().regex(isoDateRegex, 'Expected YYYY-MM-DD').optional(),
});

export const trendsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(90).default(30),
});

export const ParsedFoodItemSchema = z.object({
  food_name: z.string().trim().min(1).max(160),
  portion_desc: z.string().trim().min(1).max(160),
  calories: z.coerce.number().min(0).max(10000),
  protein_g: z.coerce.number().min(0).max(1000),
  carbs_g: z.coerce.number().min(0).max(1500),
  fat_g: z.coerce.number().min(0).max(1000),
  confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
});

export const ParseNutritionResponseSchema = z.object({
  items: z.array(ParsedFoodItemSchema),
  suggested_meal_type: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
});

export const BatchNutritionLogItemSchema = z.object({
  itemName: z.string().trim().min(1, 'Item name is required').max(160),
  portionDesc: z.string().trim().max(160).optional(),
  mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']),
  calories: z.coerce.number().min(0).max(10000),
  proteinG: z.coerce.number().min(0).max(1000),
  carbsG: z.coerce.number().min(0).max(1500),
  fatG: z.coerce.number().min(0).max(1000),
  loggedDate: z.string().regex(isoDateRegex, 'Expected YYYY-MM-DD').optional(),
});

export const CreateBatchNutritionLogsSchema = z.object({
  source: z.enum(['MANUAL', 'AI_TEXT', 'AI_IMAGE']).default('AI_TEXT'),
  items: z
    .array(BatchNutritionLogItemSchema)
    .min(1, 'At least one food item is required')
    .max(30),
});

function emptyToUndefined(val: unknown): unknown {
  if (val === undefined || val === null) {
    return undefined;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (
      trimmed === '' ||
      trimmed.toLowerCase() === 'null' ||
      trimmed.toLowerCase() === 'undefined'
    ) {
      return undefined;
    }
    return trimmed;
  }
  return val;
}

function normalizeBodyFatPct(val: number): number {
  if (val > 0 && val <= 1) {
    return Math.round(val * 1000) / 10;
  }
  return Math.round(val * 10) / 10;
}

export const AppleHealthWebhookPayloadSchema = z.object({
  recorded_date: z.preprocess(
    emptyToUndefined,
    z.string().regex(isoDateRegex, 'Expected YYYY-MM-DD').optional(),
  ),
  weight_kg: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(20).max(400).optional(),
  ),
  body_fat_pct: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(0).max(75).transform(normalizeBodyFatPct).optional(),
  ),
  skeletal_muscle_kg: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(5).max(150).optional(),
  ),
  resting_hr: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(25).max(220).optional(),
  ),
  sleep_hours: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(0).max(24).optional(),
  ),
  active_calories: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(0).max(10000).optional(),
  ),
});

export const SyncStatusSchema = z.object({
  last_synced_at: z.string().nullable(),
  synced_fields: z.array(z.string()),
  status: z.enum(['SUCCESS', 'NEVER']),
});

export const OnboardingProfileSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  gender: z.enum(['male', 'female', 'other']),
  birth_date: z.string().regex(isoDateRegex, 'Expected YYYY-MM-DD'),
  height_cm: z.coerce.number().min(80).max(260),
  weight_kg: z.coerce.number().min(20).max(400),
  body_fat_pct: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(2).max(75).nullable().optional(),
  ),
  skeletal_muscle_kg: z.preprocess(
    emptyToUndefined,
    z.coerce.number().min(5).max(150).nullable().optional(),
  ),
  baseline_activity_multiplier: z.coerce.number().min(1.1).max(2.2).default(1.35),
  goal_type: z.enum(['CUT', 'MAINTAIN', 'BULK']),
  calorie_adjustment: z.coerce.number().int().min(-1500).max(1500),
  protein_per_kg: z.coerce.number().min(0.8).max(3.5).default(2.0),
  fat_ratio: z.coerce.number().min(0.15).max(0.5).default(0.25),
});

export const WebhookKeyResponseSchema = z.object({
  api_key: z.string().min(1),
  masked_key: z.string().min(1),
  created_at: z.string(),
});

export const SupplementConfigSchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, 'Supplement key is required')
    .max(64)
    .regex(
      /^[a-z0-9_-]+$/,
      'Key must contain lowercase letters, numbers, hyphens, or underscores',
    ),
  name: z.string().trim().min(1, 'Supplement name is required').max(80),
  dosage: z.string().trim().min(1, 'Dosage is required').max(60),
  timing: z.string().trim().min(1, 'Timing is required').max(60),
});

export const UpdateSupplementsSchema = z.object({
  supplements: z
    .array(SupplementConfigSchema)
    .max(30)
    .refine(
      (items) => new Set(items.map((i) => i.key)).size === items.length,
      'Supplement keys must be unique',
    ),
});

export const WeekdayKeySchema = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

export const CalorieCyclingDayOffsetsSchema = z.object({
  mon: z.coerce.number().int().min(-800).max(800),
  tue: z.coerce.number().int().min(-800).max(800),
  wed: z.coerce.number().int().min(-800).max(800),
  thu: z.coerce.number().int().min(-800).max(800),
  fri: z.coerce.number().int().min(-800).max(800),
  sat: z.coerce.number().int().min(-800).max(800),
  sun: z.coerce.number().int().min(-800).max(800),
});

export const CalorieCyclingConfigSchema = z.object({
  enabled: z.boolean(),
  mode: z.enum(['NONE', 'TRAINING_REST', 'WEEKEND_BUFFER', 'CUSTOM']),
  dayOffsets: CalorieCyclingDayOffsetsSchema,
  trainingDayOffset: z.coerce.number().int().min(-500).max(800).default(200),
  restDayOffset: z.coerce.number().int().min(-800).max(500).default(-150),
  trainingDays: z.array(WeekdayKeySchema).max(7).default(['mon', 'wed', 'fri', 'sat']),
});

export const UpdateProfileSettingsSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  gender: z.enum(['male', 'female', 'other']),
  birth_date: z.string().regex(isoDateRegex, 'Expected YYYY-MM-DD'),
  height_cm: z.coerce.number().min(80).max(260),
  baseline_activity_multiplier: z.coerce.number().min(1.1).max(2.2),
  goal_type: z.enum(['CUT', 'MAINTAIN', 'BULK']),
  calorie_adjustment: z.coerce.number().int().min(-1500).max(1500),
  protein_per_kg: z.coerce.number().min(0.8).max(3.5),
  fat_ratio: z.coerce.number().min(0.15).max(0.5),
  calorie_cycling: CalorieCyclingConfigSchema.nullable().optional(),
});

export const calendarQuerySchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Expected YYYY-MM').optional(),
});

export const WeeklyCoachQuerySchema = z.object({
  weekStart: z.string().regex(isoDateRegex, 'Expected YYYY-MM-DD').optional(),
});

export const GenerateWeeklyCoachSchema = z.object({
  weekStart: z.string().regex(isoDateRegex, 'Expected YYYY-MM-DD').optional(),
  force: z.boolean().optional().default(false),
});

export const ApplyWeeklyCoachSchema = z.object({
  reportId: z.string().trim().min(1, 'Report ID is required').max(120),
});

export const WeeklyCoachAiNarrativeSchema = z.object({
  weeklyScore: z.coerce.number().min(0).max(100),
  headline: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1).max(600),
  wins: z.array(z.string().trim().min(1).max(240)).min(1).max(4),
  bottlenecks: z.array(z.string().trim().min(1).max(240)).max(4),
  actionPlan: z.array(z.string().trim().min(1).max(240)).min(1).max(4),
  adjustmentRationale: z.string().trim().min(1).max(400),
});

export type CreateNutritionLogInput = z.infer<typeof createNutritionLogSchema>;
export type CreateWorkoutLogInput = z.infer<typeof createWorkoutLogSchema>;
export type ToggleSupplementInput = z.infer<typeof toggleSupplementSchema>;
export type CreateBodyMetricInput = z.infer<typeof createBodyMetricSchema>;
export type TrendsQueryInput = z.infer<typeof trendsQuerySchema>;
export type ParsedFoodItem = z.infer<typeof ParsedFoodItemSchema>;
export type ParseNutritionResponse = z.infer<typeof ParseNutritionResponseSchema>;
export type BatchNutritionLogItemInput = z.infer<typeof BatchNutritionLogItemSchema>;
export type CreateBatchNutritionLogsInput = z.infer<typeof CreateBatchNutritionLogsSchema>;
export type AppleHealthWebhookPayload = z.infer<typeof AppleHealthWebhookPayloadSchema>;
export type SyncStatusDTO = z.infer<typeof SyncStatusSchema>;
export type OnboardingProfileInput = z.infer<typeof OnboardingProfileSchema>;
export type WebhookKeyResponse = z.infer<typeof WebhookKeyResponseSchema>;
export type UpdateSupplementsInput = z.infer<typeof UpdateSupplementsSchema>;
export type UpdateProfileSettingsInput = z.infer<typeof UpdateProfileSettingsSchema>;
export type CalendarQueryInput = z.infer<typeof calendarQuerySchema>;
export type CalorieCyclingConfigInput = z.infer<typeof CalorieCyclingConfigSchema>;
export type WeeklyCoachQueryInput = z.infer<typeof WeeklyCoachQuerySchema>;
export type GenerateWeeklyCoachInput = z.infer<typeof GenerateWeeklyCoachSchema>;
export type ApplyWeeklyCoachInput = z.infer<typeof ApplyWeeklyCoachSchema>;
