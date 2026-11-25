import type { BmrFormula, GoalType, ReadinessStatus, ReadinessSummary, Sex } from '@health-dash/shared';

export interface CalculateBmrInput {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  bodyFatPct?: number | null;
}

export interface CalculateBmrResult {
  bmr: number;
  formula: BmrFormula;
  leanBodyMassKg: number | null;
}

export interface CalculateDynamicTdeeInput {
  bmr: number;
  baselineActivityMultiplier: number;
  activeCalories: number;
}

export interface CalculateDynamicTdeeResult {
  baselineTdee: number;
  dynamicTdee: number;
}

export interface CalculateTargetCaloriesInput {
  dynamicTdee: number;
  calorieAdjustment: number;
}

export interface CalculateMacroTargetsInput {
  targetCalories: number;
  weightKg: number;
  proteinPerKg: number;
  fatRatio: number;
}

export interface CalculateMacroTargetsResult {
  proteinG: number;
  fatG: number;
  carbsG: number;
}

export interface EvaluateReadinessInput {
  consumedCalories: number;
  targetCalories: number;
  consumedProteinG: number;
  targetProteinG: number;
  activeCalories: number;
  goalType: GoalType;
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Calculates full completed years between birthDate (YYYY-MM-DD) and referenceDate (YYYY-MM-DD).
 */
export function calculateAge(birthDate: string, referenceDate?: string): number {
  const ref = referenceDate ?? formatLocalDate(new Date());
  const [birthYear, birthMonth, birthDay] = birthDate.split('-').map(Number);
  const [refYear, refMonth, refDay] = ref.split('-').map(Number);

  let age = refYear - birthYear;
  if (refMonth < birthMonth || (refMonth === birthMonth && refDay < birthDay)) {
    age -= 1;
  }

  return Math.max(0, age);
}

/**
 * Calculates Basal Metabolic Rate using Katch-McArdle whenever bodyFatPct is available,
 * otherwise falls back to Mifflin-St Jeor.
 */
export function calculateBmr({
  weightKg,
  heightCm,
  age,
  sex,
  bodyFatPct,
}: CalculateBmrInput): CalculateBmrResult {
  if (bodyFatPct != null && Number.isFinite(bodyFatPct)) {
    const rawLbm = weightKg * (1 - bodyFatPct / 100);
    const bmr = Math.round(370 + 21.6 * rawLbm);
    return {
      bmr,
      formula: 'katch_mcardle',
      leanBodyMassKg: roundTo(rawLbm, 2),
    };
  }

  const sexOffset = sex === 'male' ? 5 : sex === 'female' ? -161 : -78;
  const bmr = Math.round(10 * weightKg + 6.25 * heightCm - 5 * age + sexOffset);
  return {
    bmr,
    formula: 'mifflin_st_jeor',
    leanBodyMassKg: null,
  };
}

/**
 * Computes baseline sedentary/NEAT TDEE and dynamic TDEE including logged workout active calories.
 */
export function calculateDynamicTdee({
  bmr,
  baselineActivityMultiplier,
  activeCalories,
}: CalculateDynamicTdeeInput): CalculateDynamicTdeeResult {
  const baselineTdee = Math.round(bmr * baselineActivityMultiplier);
  const dynamicTdee = Math.round(bmr * baselineActivityMultiplier + activeCalories);
  return { baselineTdee, dynamicTdee };
}

/**
 * Applies goal calorie adjustment to dynamic TDEE with a safe 1200 kcal floor.
 */
export function calculateTargetCalories({
  dynamicTdee,
  calorieAdjustment,
}: CalculateTargetCaloriesInput): number {
  return Math.max(1200, Math.round(dynamicTdee + calorieAdjustment));
}

/**
 * Computes daily macro targets in grams:
 * - proteinG fixed to weightKg * proteinPerKg
 * - fatG derived from fatRatio share of targetCalories
 * - carbsG fills remaining calories with a 0g floor
 */
export function calculateMacroTargets({
  targetCalories,
  weightKg,
  proteinPerKg,
  fatRatio,
}: CalculateMacroTargetsInput): CalculateMacroTargetsResult {
  const proteinG = Math.round(weightKg * proteinPerKg);
  const fatG = Math.round((targetCalories * fatRatio) / 9);
  const carbsG = Math.max(0, Math.round((targetCalories - proteinG * 4 - fatG * 9) / 4));
  return { proteinG, fatG, carbsG };
}

function getTrainingLoadLevel(
  activeCalories: number,
): ReadinessSummary['trainingLoadLevel'] {
  if (activeCalories <= 0) return 'rest';
  if (activeCalories < 300) return 'light';
  if (activeCalories < 650) return 'moderate';
  return 'high';
}

/**
 * Evaluates daily energy/protein adherence and training load into a concise 3-second readiness signal.
 */
export function evaluateReadiness({
  consumedCalories,
  targetCalories,
  consumedProteinG,
  targetProteinG,
  activeCalories,
  goalType,
}: EvaluateReadinessInput): ReadinessSummary {
  const calorieAdherencePct =
    targetCalories > 0 ? Math.round((consumedCalories / targetCalories) * 100) : 0;
  const proteinAdherencePct =
    targetProteinG > 0 ? Math.round((consumedProteinG / targetProteinG) * 100) : 0;
  const trainingLoadLevel = getTrainingLoadLevel(activeCalories);

  const upperOverloadPct = goalType === 'CUT' ? 118 : goalType === 'MAINTAIN' ? 122 : 130;
  const lowerOptimalPct = goalType === 'BULK' ? 85 : 80;
  const upperOptimalPct = goalType === 'CUT' ? 105 : goalType === 'MAINTAIN' ? 110 : 115;

  const isCalorieOverload = calorieAdherencePct > upperOverloadPct;
  const isSevereUnderfuel =
    (trainingLoadLevel === 'high' && calorieAdherencePct < 45) ||
    (activeCalories >= 400 && calorieAdherencePct < 25);

  // Score starts at 100 and deducts smoothly for calorie/protein deviation and excessive uncompensated strain
  const calorieDeviation =
    calorieAdherencePct >= lowerOptimalPct && calorieAdherencePct <= upperOptimalPct
      ? 0
      : calorieAdherencePct < lowerOptimalPct
        ? (lowerOptimalPct - calorieAdherencePct) * 0.55
        : (calorieAdherencePct - upperOptimalPct) * 1.35;

  const proteinPenalty =
    proteinAdherencePct >= 85 ? 0 : (85 - proteinAdherencePct) * 0.35;

  const strainPenalty =
    trainingLoadLevel === 'high' && calorieAdherencePct < 60
      ? 14
      : trainingLoadLevel === 'high' && proteinAdherencePct < 60
        ? 8
        : 0;

  const score = Math.max(
    5,
    Math.min(100, Math.round(100 - calorieDeviation - proteinPenalty - strainPenalty)),
  );

  let status: ReadinessStatus;
  if (isCalorieOverload || isSevereUnderfuel || score < 55) {
    status = 'overload';
  } else if (
    calorieAdherencePct >= lowerOptimalPct &&
    calorieAdherencePct <= upperOptimalPct &&
    proteinAdherencePct >= 80 &&
    score >= 78
  ) {
    status = 'optimal';
  } else {
    status = 'moderate';
  }

  const remainingCalories = Math.round(targetCalories - consumedCalories);
  const remainingProteinG = Math.max(0, Math.round(targetProteinG - consumedProteinG));

  let badge: string;
  let headline: string;
  let summary: string;

  if (status === 'optimal') {
    badge = 'Optimal Fuel';
    headline =
      goalType === 'CUT'
        ? 'On track for clean recomposition'
        : goalType === 'BULK'
          ? 'Surplus & protein dialed in'
          : 'Energy balance locked in';
    summary = `${calorieAdherencePct}% of target kcal and ${proteinAdherencePct}% protein hit with ${activeCalories} active kcal.`;
  } else if (status === 'overload') {
    if (isCalorieOverload) {
      const surplus = Math.abs(remainingCalories);
      badge = goalType === 'CUT' ? 'Cut Overrun' : 'Surplus Alert';
      headline = `${surplus} kcal above daily target`;
      summary = `Intake reached ${calorieAdherencePct}% of ${targetCalories} kcal target; tighten evening macros or add light movement.`;
    } else {
      badge = 'Under-Fueled';
      headline = 'High training load needs fuel';
      summary = `${activeCalories} active kcal burned at only ${calorieAdherencePct}% intake; prioritize ${remainingProteinG}g protein & carbs.`;
    }
  } else {
    if (remainingCalories > 0) {
      badge = 'Fuel Window Open';
      headline = `${remainingCalories} kcal remaining today`;
      summary = `${remainingProteinG}g protein left to hit target alongside ${activeCalories} active kcal burned.`;
    } else {
      badge = 'Slight Drift';
      headline = `${Math.abs(remainingCalories)} kcal over target`;
      summary = `Protein at ${proteinAdherencePct}% of target; keep remaining intake light.`;
    }
  }

  return {
    status,
    score,
    badge,
    headline,
    summary,
    calorieAdherencePct,
    proteinAdherencePct,
    trainingLoadLevel,
  };
}
