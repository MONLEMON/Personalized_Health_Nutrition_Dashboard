import { eq } from 'drizzle-orm';
import { closeDb, getDb } from './index';
import {
  bodyMetrics,
  nutritionLogs,
  userGoals,
  userProfiles,
  workoutLogs,
} from './schema';
import { createSeedDataset } from './seed-data';

async function main() {
  const db = getDb();
  if (!db) {
    console.error(
      'DATABASE_URL is not set. Skipping PostgreSQL seed (the API uses InMemoryHealthRepository automatically when DATABASE_URL is unset).',
    );
    process.exit(1);
  }

  const dataset = createSeedDataset();
  console.log(`Seeding Personalized Health & Nutrition Dashboard for ${dataset.today}...`);

  await db.transaction(async (tx) => {
    // Delete existing seed user (cascades to goals, metrics, workouts, nutrition)
    await tx.delete(userProfiles).where(eq(userProfiles.id, dataset.profile.id));

    await tx.insert(userProfiles).values({
      id: dataset.profile.id,
      name: dataset.profile.name,
      sex: dataset.profile.sex,
      birthDate: dataset.profile.birthDate,
      heightCm: dataset.profile.heightCm,
      baselineActivityMultiplier: dataset.profile.baselineActivityMultiplier,
      tdeeMode: dataset.profile.tdeeMode ?? 'MANUAL_WORKOUT_DYNAMIC',
      supplementStack: dataset.profile.supplementStack,
    });

    await tx.insert(userGoals).values({
      id: dataset.goal.id,
      userId: dataset.goal.userId,
      goalType: dataset.goal.goalType,
      calorieAdjustment: dataset.goal.calorieAdjustment,
      proteinPerKg: dataset.goal.proteinPerKg,
      fatRatio: dataset.goal.fatRatio,
      isActive: dataset.goal.isActive,
    });

    if (dataset.bodyMetrics.length > 0) {
      await tx.insert(bodyMetrics).values(
        dataset.bodyMetrics.map((m) => ({
          id: m.id,
          userId: m.userId,
          recordedDate: m.recordedDate,
          weightKg: m.weightKg,
          bodyFatPct: m.bodyFatPct,
          skeletalMuscleMassKg: m.skeletalMuscleMassKg,
          notes: m.notes,
        })),
      );
    }

    if (dataset.workoutLogs.length > 0) {
      await tx.insert(workoutLogs).values(
        dataset.workoutLogs.map((w) => ({
          id: w.id,
          userId: w.userId,
          loggedDate: w.loggedDate,
          activityName: w.activityName,
          category: w.category,
          durationMin: w.durationMin,
          activeCalories: w.activeCalories,
          intensity: w.intensity,
          loggedAt: new Date(w.loggedAt),
        })),
      );
    }

    if (dataset.nutritionLogs.length > 0) {
      await tx.insert(nutritionLogs).values(
        dataset.nutritionLogs.map((n) => ({
          id: n.id,
          userId: n.userId,
          loggedDate: n.loggedDate,
          mealType: n.mealType,
          itemName: n.itemName,
          calories: n.calories,
          proteinG: n.proteinG,
          carbsG: n.carbsG,
          fatG: n.fatG,
          supplementKey: n.supplementKey,
          loggedAt: new Date(n.loggedAt),
        })),
      );
    }
  });

  console.log(
    `Seeded 1 profile, 1 goal, ${dataset.bodyMetrics.length} body metrics, ${dataset.workoutLogs.length} workouts, and ${dataset.nutritionLogs.length} nutrition/supplement logs.`,
  );
}

main()
  .catch((error) => {
    console.error('Failed to seed database:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
