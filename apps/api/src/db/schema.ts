import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  GoalType,
  MealType,
  NutritionLogSource,
  Sex,
  SupplementConfig,
  WorkoutCategory,
  WorkoutIntensity,
} from '@health-dash/shared';

export const userProfiles = pgTable('user_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sex: text('sex').$type<Sex>().notNull(),
  birthDate: text('birth_date').notNull(),
  heightCm: doublePrecision('height_cm').notNull(),
  baselineActivityMultiplier: doublePrecision('baseline_activity_multiplier').notNull(),
  supplementStack: jsonb('supplement_stack').$type<SupplementConfig[]>().notNull(),
  webhookKeyHash: text('webhook_key_hash').unique(),
  webhookKeyPrefix: varchar('webhook_key_prefix', { length: 32 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const userGoals = pgTable(
  'user_goals',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    goalType: text('goal_type').$type<GoalType>().notNull(),
    calorieAdjustment: integer('calorie_adjustment').notNull(),
    proteinPerKg: doublePrecision('protein_per_kg').notNull(),
    fatRatio: doublePrecision('fat_ratio').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('user_goals_user_active_idx').on(table.userId, table.isActive)],
);

export const bodyMetrics = pgTable(
  'body_metrics',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    recordedDate: text('recorded_date').notNull(),
    weightKg: doublePrecision('weight_kg').notNull(),
    bodyFatPct: doublePrecision('body_fat_pct'),
    skeletalMuscleMassKg: doublePrecision('skeletal_muscle_mass_kg'),
    restingHr: doublePrecision('resting_hr'),
    sleepHours: doublePrecision('sleep_hours'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('body_metrics_user_date_uniq').on(table.userId, table.recordedDate),
  ],
);

export const workoutLogs = pgTable(
  'workout_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    loggedDate: text('logged_date').notNull(),
    activityName: text('activity_name').notNull(),
    category: text('category').$type<WorkoutCategory>().notNull(),
    durationMin: integer('duration_min').notNull(),
    activeCalories: doublePrecision('active_calories').notNull(),
    intensity: text('intensity').$type<WorkoutIntensity>().notNull(),
    activityType: text('activity_type').notNull().default('MANUAL'),
    loggedAt: timestamp('logged_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('workout_logs_user_date_idx').on(table.userId, table.loggedDate),
    index('workout_logs_user_date_type_idx').on(
      table.userId,
      table.loggedDate,
      table.activityType,
    ),
  ],
);

export const nutritionLogs = pgTable(
  'nutrition_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    loggedDate: text('logged_date').notNull(),
    mealType: text('meal_type').$type<MealType>().notNull(),
    itemName: text('item_name').notNull(),
    calories: doublePrecision('calories').notNull(),
    proteinG: doublePrecision('protein_g').notNull(),
    carbsG: doublePrecision('carbs_g').notNull(),
    fatG: doublePrecision('fat_g').notNull(),
    supplementKey: text('supplement_key'),
    source: text('source').$type<NutritionLogSource>().notNull().default('MANUAL'),
    loggedAt: timestamp('logged_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('nutrition_logs_user_date_idx').on(table.userId, table.loggedDate)],
);

export const syncLogs = pgTable(
  'sync_logs',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => userProfiles.id, { onDelete: 'cascade' }),
    source: text('source').notNull().default('APPLE_HEALTH'),
    payloadSummary: jsonb('payload_summary')
      .$type<{ recorded_date: string; synced_fields: string[] }>()
      .notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('sync_logs_user_synced_idx').on(table.userId, table.syncedAt)],
);
