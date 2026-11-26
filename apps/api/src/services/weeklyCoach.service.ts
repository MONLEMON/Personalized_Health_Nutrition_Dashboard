import {
  GoogleGenAI,
  Type,
  type GenerateContentConfig,
  type Part,
  type Schema,
} from '@google/genai';
import {
  WeeklyCoachAiNarrativeSchema,
  type BodyMetricDTO,
  type CoachAdjustmentDirection,
  type CoachRecommendationReasonCode,
  type NutritionLogDTO,
  type UserGoalDTO,
  type UserProfileDTO,
  type WeeklyCoachAiNarrativeDTO,
  type WeeklyCoachMetricsDTO,
  type WeeklyCoachRecommendationDTO,
  type WorkoutLogDTO,
} from '@health-dash/shared';
import { loadRootEnv } from '../db/load-env';
import {
  DEFAULT_ATTEMPT_TIMEOUT_MS,
  DEFAULT_GEMINI_MODEL,
  FALLBACK_GEMINI_MODELS,
  type GeminiGenerateContentFn,
} from './aiNutrition';
import {
  calculateAge,
  calculateBmr,
  calculateDynamicTdee,
  calculateMacroTargets,
  calculateTargetCalories,
  getWeekdayKey,
  resolveCalorieCyclingForDate,
} from './tdee.service';

const DEFAULT_FALLBACK_WEIGHT_KG = 75;

const bangkokDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function getBangkokTodayString(): string {
  return bangkokDateFormatter.format(new Date());
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clampText(value: string, maxLen: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen - 1).trimEnd()}…`;
}

/**
 * Shifts a YYYY-MM-DD calendar date string by deltaDays using UTC calendar math.
 */
export function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day + deltaDays));
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns the Monday-through-Sunday bounds and 7 ISO dates containing referenceDate
 * (defaulting to today's Asia/Bangkok date).
 */
export function getWeekBounds(referenceDate?: string): {
  weekStartDate: string;
  weekEndDate: string;
  dates: string[];
} {
  const resolvedRef = referenceDate ?? getBangkokTodayString();
  const [year, month, day] = resolvedRef.split('-').map(Number);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const daysSinceMonday = (utcDay + 6) % 7;
  const weekStartDate = shiftIsoDate(resolvedRef, -daysSinceMonday);
  const dates = Array.from({ length: 7 }, (_, idx) => shiftIsoDate(weekStartDate, idx));
  return {
    weekStartDate,
    weekEndDate: dates[6],
    dates,
  };
}

export interface ComputeWeeklyCoachMetricsInput {
  weekStartDate: string;
  profile: UserProfileDTO;
  goal: UserGoalDTO;
  metricsUpToWeekEnd: BodyMetricDTO[];
  workoutsForWeek: WorkoutLogDTO[];
  nutritionForWeek: NutritionLogDTO[];
}

function computeWindowWeightMa7(
  sortedMetricsAsc: BodyMetricDTO[],
  windowEndDate: string,
): number | null {
  const eligible = sortedMetricsAsc.filter((m) => m.recordedDate <= windowEndDate);
  if (eligible.length === 0) {
    return null;
  }

  const windowStartDate = shiftIsoDate(windowEndDate, -6);
  const inWindow = eligible.filter((m) => m.recordedDate >= windowStartDate);
  if (inWindow.length > 0) {
    const sum = inWindow.reduce((acc, m) => acc + m.weightKg, 0);
    return roundTo(sum / inWindow.length, 2);
  }

  return roundTo(eligible[eligible.length - 1].weightKg, 2);
}

/**
 * Aggregates a Mon-Sun week of nutrition, workouts, body composition trends,
 * recovery signals, and Observed TDEE into a WeeklyCoachMetricsDTO.
 */
export function computeWeeklyCoachMetrics(
  params: ComputeWeeklyCoachMetricsInput,
): WeeklyCoachMetricsDTO {
  const { profile, goal, metricsUpToWeekEnd, workoutsForWeek, nutritionForWeek } = params;
  const { weekStartDate, weekEndDate, dates } = getWeekBounds(params.weekStartDate);

  // Deduplicate by recordedDate (keep latest) and sort ascending
  const metricByDate = new Map<string, BodyMetricDTO>();
  const rawSortedMetrics = [...metricsUpToWeekEnd]
    .filter((m) => m.recordedDate <= weekEndDate)
    .sort((a, b) => a.recordedDate.localeCompare(b.recordedDate));
  for (const m of rawSortedMetrics) {
    metricByDate.set(m.recordedDate, m);
  }
  const sortedMetrics = Array.from(metricByDate.values());
  const earliestFallbackMetric = sortedMetrics[0] ?? null;

  const workoutsByDate = new Map<string, WorkoutLogDTO[]>();
  const weekWorkouts = workoutsForWeek.filter(
    (w) => w.loggedDate >= weekStartDate && w.loggedDate <= weekEndDate,
  );
  for (const w of weekWorkouts) {
    const list = workoutsByDate.get(w.loggedDate);
    if (list) list.push(w);
    else workoutsByDate.set(w.loggedDate, [w]);
  }

  const nutritionByDate = new Map<string, NutritionLogDTO[]>();
  const weekNutrition = nutritionForWeek.filter(
    (n) => n.loggedDate >= weekStartDate && n.loggedDate <= weekEndDate,
  );
  for (const n of weekNutrition) {
    const list = nutritionByDate.get(n.loggedDate);
    if (list) list.push(n);
    else nutritionByDate.set(n.loggedDate, [n]);
  }

  let carryForwardMetric: BodyMetricDTO | null = null;
  let metricPtr = 0;

  let daysLogged = 0;
  let sumMealCalories = 0;
  let sumMealProteinG = 0;
  let sumTargetCalories = 0;
  let sumProteinTargetG = 0;
  let sumDynamicTdee = 0;

  let weekdayMealDays = 0;
  let weekdayCaloriesSum = 0;
  let weekendMealDays = 0;
  let weekendCaloriesSum = 0;

  let workoutDays = 0;
  let totalSupplementsTaken = 0;
  let daysWithSupplements = 0;

  for (const dayDate of dates) {
    while (
      metricPtr < sortedMetrics.length &&
      sortedMetrics[metricPtr].recordedDate <= dayDate
    ) {
      carryForwardMetric = sortedMetrics[metricPtr];
      metricPtr++;
    }

    const refMetric = carryForwardMetric ?? earliestFallbackMetric;
    const refWeightKg = refMetric?.weightKg ?? DEFAULT_FALLBACK_WEIGHT_KG;
    const refBodyFatPct = refMetric?.bodyFatPct ?? null;

    const age = calculateAge(profile.birthDate, dayDate);
    const bmrResult = calculateBmr({
      weightKg: refWeightKg,
      heightCm: profile.heightCm,
      age,
      sex: profile.sex,
      bodyFatPct: refBodyFatPct,
    });

    const dayWorkouts = workoutsByDate.get(dayDate) ?? [];
    const activeCalories = Math.round(
      dayWorkouts.reduce((sum, w) => sum + w.activeCalories, 0),
    );
    if (dayWorkouts.some((w) => w.activeCalories > 0)) {
      workoutDays++;
    }

    const { dynamicTdee } = calculateDynamicTdee({
      bmr: bmrResult.bmr,
      baselineActivityMultiplier: profile.baselineActivityMultiplier,
      activeCalories,
      tdeeMode: profile.tdeeMode,
    });
    sumDynamicTdee += dynamicTdee;

    const cycling = resolveCalorieCyclingForDate(
      goal.calorieCycling,
      dayDate,
      dayWorkouts.length > 0,
    );
    const baseTargetCalories = calculateTargetCalories({
      dynamicTdee,
      calorieAdjustment: goal.calorieAdjustment,
    });
    const targetCalories = calculateTargetCalories({
      dynamicTdee,
      calorieAdjustment: goal.calorieAdjustment,
      cyclingOffset: cycling.offset,
    });
    const macroTargets = calculateMacroTargets({
      targetCalories,
      baseTargetCaloriesForFat: baseTargetCalories,
      weightKg: refWeightKg,
      proteinPerKg: goal.proteinPerKg,
      fatRatio: goal.fatRatio,
    });

    sumTargetCalories += targetCalories;
    sumProteinTargetG += macroTargets.proteinG;

    const dayNutrition = nutritionByDate.get(dayDate) ?? [];
    const meals = dayNutrition.filter((item) => item.mealType !== 'supplement');
    if (meals.length > 0) {
      daysLogged++;
      const dayCalories = meals.reduce((sum, m) => sum + m.calories, 0);
      const dayProtein = meals.reduce((sum, m) => sum + m.proteinG, 0);
      sumMealCalories += dayCalories;
      sumMealProteinG += dayProtein;

      const weekday = getWeekdayKey(dayDate);
      if (weekday === 'sat' || weekday === 'sun') {
        weekendMealDays++;
        weekendCaloriesSum += dayCalories;
      } else {
        weekdayMealDays++;
        weekdayCaloriesSum += dayCalories;
      }
    }

    const supplementsTakenToday = new Set(
      dayNutrition
        .filter((item) => item.mealType === 'supplement' && item.supplementKey)
        .map((item) => item.supplementKey as string),
    ).size;
    if (supplementsTakenToday > 0) {
      daysWithSupplements++;
      totalSupplementsTaken += supplementsTakenToday;
    }
  }

  const avgIntakeCalories = daysLogged > 0 ? Math.round(sumMealCalories / daysLogged) : 0;
  const avgTargetCalories = Math.round(sumTargetCalories / 7);
  const avgProteinG = daysLogged > 0 ? roundTo(sumMealProteinG / daysLogged, 1) : 0;
  const avgProteinTargetG = Math.round(sumProteinTargetG / 7);

  const calorieAdherencePct =
    daysLogged > 0 && avgTargetCalories > 0
      ? Math.round((avgIntakeCalories / avgTargetCalories) * 100)
      : 0;
  const proteinAdherencePct =
    daysLogged > 0 && avgProteinTargetG > 0
      ? Math.round((avgProteinG / avgProteinTargetG) * 100)
      : 0;

  const totalActiveCalories = Math.round(
    weekWorkouts.reduce((sum, w) => sum + w.activeCalories, 0),
  );

  const supplementsTotal = profile.supplementStack.length;
  const supplementDenomDays = Math.max(daysLogged, daysWithSupplements);
  const supplementAdherencePct =
    supplementsTotal > 0 && supplementDenomDays > 0
      ? Math.min(
          100,
          Math.round((totalSupplementsTaken / (supplementDenomDays * supplementsTotal)) * 100),
        )
      : 0;

  const weekdayAvgCalories =
    weekdayMealDays > 0 ? Math.round(weekdayCaloriesSum / weekdayMealDays) : null;
  const weekendAvgCalories =
    weekendMealDays > 0 ? Math.round(weekendCaloriesSum / weekendMealDays) : null;

  const currentWeightMa7 = computeWindowWeightMa7(sortedMetrics, weekEndDate);
  const prevEnd = shiftIsoDate(weekStartDate, -1);
  const previousWeightMa7 = computeWindowWeightMa7(sortedMetrics, prevEnd);

  const weightDeltaKg =
    currentWeightMa7 !== null && previousWeightMa7 !== null
      ? roundTo(currentWeightMa7 - previousWeightMa7, 2)
      : null;
  const weightDeltaPct =
    weightDeltaKg !== null && previousWeightMa7 !== null && previousWeightMa7 > 0
      ? roundTo((weightDeltaKg / previousWeightMa7) * 100, 2)
      : null;

  const observedTdee =
    daysLogged >= 5 && weightDeltaKg !== null && avgIntakeCalories > 0
      ? Math.max(
          1000,
          Math.min(6000, Math.round(avgIntakeCalories - (weightDeltaKg * 7700) / 7)),
        )
      : null;
  const estimatedTdee = Math.round(sumDynamicTdee / 7);

  const weekMetrics = sortedMetrics.filter(
    (m) => m.recordedDate >= weekStartDate && m.recordedDate <= weekEndDate,
  );
  const sleepValues = weekMetrics
    .map((m) => m.sleepHours)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const restingHrValues = weekMetrics
    .map((m) => m.restingHr)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const avgSleepHours =
    sleepValues.length > 0
      ? roundTo(sleepValues.reduce((sum, v) => sum + v, 0) / sleepValues.length, 2)
      : null;
  const avgRestingHr =
    restingHrValues.length > 0
      ? roundTo(
          restingHrValues.reduce((sum, v) => sum + v, 0) / restingHrValues.length,
          1,
        )
      : null;

  return {
    weekStartDate,
    weekEndDate,
    daysLogged,
    avgIntakeCalories,
    avgTargetCalories,
    avgProteinG,
    avgProteinTargetG,
    proteinAdherencePct,
    calorieAdherencePct,
    totalActiveCalories,
    workoutDays,
    supplementAdherencePct,
    weekdayAvgCalories,
    weekendAvgCalories,
    currentWeightMa7,
    previousWeightMa7,
    weightDeltaKg,
    weightDeltaPct,
    observedTdee,
    estimatedTdee,
    avgSleepHours,
    avgRestingHr,
  };
}

/**
 * Computes a deterministic adaptive calorie adjustment recommendation
 * from weekly metrics and the user's active goal.
 */
export function evaluateAdaptiveAdjustment(
  metrics: WeeklyCoachMetricsDTO,
  goal: UserGoalDTO,
): WeeklyCoachRecommendationDTO {
  const currentCalorieAdjustment = goal.calorieAdjustment;

  if (metrics.daysLogged < 5 || metrics.weightDeltaPct === null) {
    return {
      direction: 'MAINTAIN',
      deltaKcal: 0,
      currentCalorieAdjustment,
      suggestedCalorieAdjustment: currentCalorieAdjustment,
      reasonCode: 'INSUFFICIENT_DATA',
      canApply: false,
    };
  }

  const pct = metrics.weightDeltaPct;
  let direction: CoachAdjustmentDirection = 'MAINTAIN';
  let deltaKcal = 0;
  let reasonCode: CoachRecommendationReasonCode = 'ON_TRACK';

  if (goal.goalType === 'CUT') {
    if (pct < -0.9) {
      direction = 'INCREASE';
      deltaKcal = 125;
      reasonCode = 'CUT_TOO_FAST';
    } else if (pct > -0.2) {
      direction = 'DECREASE';
      deltaKcal = -125;
      reasonCode = 'CUT_TOO_SLOW';
    }
  } else if (goal.goalType === 'BULK') {
    if (pct < 0.1) {
      direction = 'INCREASE';
      deltaKcal = 125;
      reasonCode = 'BULK_TOO_SLOW';
    } else if (pct > 0.55) {
      direction = 'DECREASE';
      deltaKcal = -125;
      reasonCode = 'BULK_TOO_FAST';
    }
  } else {
    if (pct > 0.35) {
      direction = 'DECREASE';
      deltaKcal = -100;
      reasonCode = 'MAINTAIN_GAINING';
    } else if (pct < -0.35) {
      direction = 'INCREASE';
      deltaKcal = 100;
      reasonCode = 'MAINTAIN_LOSING';
    }
  }

  const suggestedCalorieAdjustment =
    deltaKcal === 0
      ? currentCalorieAdjustment
      : Math.max(-1200, Math.min(1200, Math.round(currentCalorieAdjustment + deltaKcal)));

  const canApply =
    deltaKcal !== 0 && suggestedCalorieAdjustment !== currentCalorieAdjustment;

  return {
    direction,
    deltaKcal,
    currentCalorieAdjustment,
    suggestedCalorieAdjustment,
    reasonCode,
    canApply,
  };
}

function computeDeterministicWeeklyScore(
  metrics: WeeklyCoachMetricsDTO,
  recommendation: WeeklyCoachRecommendationDTO,
): number {
  const loggingPts = (Math.min(7, metrics.daysLogged) / 7) * 30;
  const caloriePts =
    metrics.daysLogged === 0
      ? 0
      : Math.max(0, 30 - Math.abs(100 - metrics.calorieAdherencePct) * 0.8);
  const proteinPts =
    metrics.daysLogged === 0
      ? 0
      : Math.min(25, (metrics.proteinAdherencePct / 100) * 25);
  const activityPts = Math.min(10, metrics.workoutDays * 2.5);
  const suppPts = Math.min(5, (metrics.supplementAdherencePct / 100) * 5);
  const onTrackBonus = recommendation.reasonCode === 'ON_TRACK' ? 4 : 0;

  return Math.max(
    10,
    Math.min(
      100,
      Math.round(loggingPts + caloriePts + proteinPts + activityPts + suppPts + onTrackBonus),
    ),
  );
}

/**
 * Generates a deterministic Thai weekly coaching narrative fallback when Gemini is
 * unavailable or API keys are not configured.
 */
export function buildDeterministicThaiNarrative(
  metrics: WeeklyCoachMetricsDTO,
  recommendation: WeeklyCoachRecommendationDTO,
  goal: UserGoalDTO,
): WeeklyCoachAiNarrativeDTO {
  const weeklyScore = computeDeterministicWeeklyScore(metrics, recommendation);
  const goalLabel =
    goal.goalType === 'CUT' ? 'ลดไขมัน (Cut)' : goal.goalType === 'BULK' ? 'เพิ่มกล้ามเนื้อ (Bulk)' : 'คุมน้ำหนัก (Maintain)';

  let headline: string;
  let adjustmentRationale: string;

  switch (recommendation.reasonCode) {
    case 'INSUFFICIENT_DATA':
      headline = `บันทึกอาหารแล้ว ${metrics.daysLogged}/7 วัน — สะสมข้อมูลเพิ่มเพื่อปลดล็อกการปรับแคลอรี`;
      adjustmentRationale =
        metrics.daysLogged < 5
          ? `สัปดาห์นี้มีการบันทึกมื้ออาหาร ${metrics.daysLogged} วัน (ต้องการอย่างน้อย 5 วันและค่าน้ำหนักเทียบสัปดาห์ก่อน) จึงคงเป้าหมายเดิมที่ ${recommendation.currentCalorieAdjustment >= 0 ? `+${recommendation.currentCalorieAdjustment}` : recommendation.currentCalorieAdjustment} kcal ไว้ก่อน`
          : `ยังไม่มีค่าเฉลี่ยน้ำหนักสัปดาห์ก่อนหน้าสำหรับเปรียบเทียบแนวโน้ม 7 วัน จึงแนะนำให้คงเป้าหมายเดิมไปอีก 1 สัปดาห์`;
      break;
    case 'CUT_TOO_SLOW':
      headline = 'น้ำหนักลดช้ากว่าเป้าหมาย — แนะนำลดแคลอรีลงเล็กน้อย 125 kcal/วัน';
      adjustmentRationale = `น้ำหนักเฉลี่ย 7 วันเปลี่ยนแปลง ${metrics.weightDeltaPct}% (ช้ากว่าเกณฑ์ -0.2% ถึง -0.9%/สัปดาห์) จึงแนะนำปรับส่วนต่างพลังงานเป็น ${recommendation.suggestedCalorieAdjustment} kcal/วัน`;
      break;
    case 'CUT_TOO_FAST':
      headline = 'น้ำหนักลงเร็วกว่าเกณฑ์ — เพิ่มพลังงาน +125 kcal/วัน เพื่อรักษามวลกล้ามเนื้อ';
      adjustmentRationale = `น้ำหนักเฉลี่ย 7 วันลดลง ${metrics.weightDeltaPct}% ซึ่งเร็วกว่า -0.9%/สัปดาห์ การเติมคาร์บเพิ่ม +125 kcal จะช่วยคงแรงฝึกและลดการสูญเสียกล้ามเนื้อ`;
      break;
    case 'BULK_TOO_SLOW':
      headline = 'น้ำหนักขึ้นช้ากว่าเป้า Bulk — แนะนำเพิ่ม +125 kcal/วัน';
      adjustmentRationale = `น้ำหนักเฉลี่ย 7 วันขยับ ${metrics.weightDeltaPct}% (ต่ำกว่า +0.1%/สัปดาห์) แนะนำเพิ่มเป้าหมายแคลอรีขึ้น +125 kcal เพื่อผลักดันการฟื้นตัวและการสร้างกล้ามเนื้อ`;
      break;
    case 'BULK_TOO_FAST':
      headline = 'น้ำหนักขึ้นเร็วกว่าเกณฑ์ Lean Bulk — ลดส่วนเกินลง 125 kcal/วัน';
      adjustmentRationale = `น้ำหนักเฉลี่ย 7 วันเพิ่มขึ้น ${metrics.weightDeltaPct}% (สูงกว่า +0.55%/สัปดาห์) แนะนำลดแคลอรีลง -125 kcal เพื่อจำกัดไขมันสะสมส่วนเกิน`;
      break;
    case 'MAINTAIN_GAINING':
      headline = 'น้ำหนักขยับขึ้นเกินช่วงคุมน้ำหนัก — แนะนำปรับลด 100 kcal/วัน';
      adjustmentRationale = `น้ำหนักเฉลี่ย 7 วันเพิ่มขึ้น ${metrics.weightDeltaPct}% (เกิน +0.35%) การลดลง -100 kcal/วัน จะช่วยดึงสมดุลพลังงานกลับมาอยู่ในช่วงคงที่`;
      break;
    case 'MAINTAIN_LOSING':
      headline = 'น้ำหนักลดลงเกินช่วงคุมน้ำหนัก — แนะนำเติมเพิ่ม +100 kcal/วัน';
      adjustmentRationale = `น้ำหนักเฉลี่ย 7 วันลดลง ${metrics.weightDeltaPct}% (ต่ำกว่า -0.35%) การเพิ่มพลังงาน +100 kcal/วัน จะช่วยรักษาน้ำหนักและระดับพลังงานในการซ้อม`;
      break;
    case 'ON_TRACK':
    default:
      headline = `เดินเกมได้ตรงเป้าสำหรับโหมด ${goalLabel}`;
      adjustmentRationale = `น้ำหนักเฉลี่ยเปลี่ยนแปลง ${metrics.weightDeltaPct ?? 0}% ซึ่งอยู่ในช่วงที่เหมาะสมของเป้าหมาย ${goal.goalType} จึงคงส่วนต่างแคลอรีเดิม (${recommendation.currentCalorieAdjustment >= 0 ? `+${recommendation.currentCalorieAdjustment}` : recommendation.currentCalorieAdjustment} kcal)`;
      break;
  }

  const tdeeText =
    metrics.observedTdee !== null
      ? `TDEE จริงจากผลลัพธ์อยู่ที่ ~${metrics.observedTdee} kcal/วัน (เทียบกับค่าประมาณ ${metrics.estimatedTdee} kcal)`
      : `ค่า TDEE ประมาณการเฉลี่ยอยู่ที่ ${metrics.estimatedTdee} kcal/วัน`;

  const summary = clampText(
    `สัปดาห์ ${metrics.weekStartDate} ถึง ${metrics.weekEndDate}: บันทึกอาหาร ${metrics.daysLogged} วัน กินเฉลี่ย ${metrics.avgIntakeCalories} จากเป้า ${metrics.avgTargetCalories} kcal (${metrics.calorieAdherencePct}%) โปรตีน ${metrics.avgProteinG}g (${metrics.proteinAdherencePct}%) และฝึกซ้อม ${metrics.workoutDays} วัน (${metrics.totalActiveCalories} active kcal) ${tdeeText}`,
    600,
  );

  const wins: string[] = [];
  if (metrics.proteinAdherencePct >= 85) {
    wins.push(
      `ทำโปรตีนได้สม่ำเสมอ ${metrics.avgProteinG}g/วัน (${metrics.proteinAdherencePct}% ของเป้าหมาย)`,
    );
  }
  if (metrics.workoutDays >= 3) {
    wins.push(
      `ความสม่ำเสมอในการซ้อมดีมาก (${metrics.workoutDays} วัน, เผาผลาญ ${metrics.totalActiveCalories} active kcal)`,
    );
  }
  if (metrics.daysLogged >= 5) {
    wins.push(`บันทึกโภชนาการต่อเนื่อง ${metrics.daysLogged}/7 วัน ทำให้ระบบคำนวณแนวโน้มได้แม่นยำ`);
  }
  if (metrics.supplementAdherencePct >= 75) {
    wins.push(`วินัยอาหารเสริมดีเยี่ยม (${metrics.supplementAdherencePct}%)`);
  }
  if (wins.length === 0) {
    wins.push(
      `เริ่มต้นติดตามข้อมูลสัปดาห์ ${metrics.weekStartDate} แล้ว — ทุกวันที่บันทึกช่วยให้โค้ชวิเคราะห์แม่นยำขึ้น`,
    );
  }

  const bottlenecks: string[] = [];
  if (metrics.daysLogged < 5) {
    bottlenecks.push(
      `บันทึกมื้ออาหาร ${metrics.daysLogged}/7 วัน — ควรบันทึกอย่างน้อย 5 วัน/สัปดาห์เพื่อให้ Adaptive TDEE ทำงานเต็มประสิทธิภาพ`,
    );
  }
  if (metrics.daysLogged > 0 && metrics.proteinAdherencePct < 85) {
    bottlenecks.push(
      `โปรตีนเฉลี่ยยังต่ำกว่าเป้า (${metrics.avgProteinG}g / ${metrics.avgProteinTargetG}g) อาจกระทบการรักษามวลกล้ามเนื้อ`,
    );
  }
  if (
    metrics.weekdayAvgCalories !== null &&
    metrics.weekendAvgCalories !== null &&
    metrics.weekendAvgCalories - metrics.weekdayAvgCalories >= 350
  ) {
    bottlenecks.push(
      `แคลอรีวันหยุด (${metrics.weekendAvgCalories} kcal) สูงกว่าวันธรรมดา (${metrics.weekdayAvgCalories} kcal) ค่อนข้างมาก`,
    );
  }
  if (metrics.avgSleepHours !== null && metrics.avgSleepHours < 6.5) {
    bottlenecks.push(
      `เวลานอนเฉลี่ย ${metrics.avgSleepHours} ชม./คืน ยังน้อยกว่า 7 ชม. ซึ่งอาจเพิ่มความหิวและชะลอการฟื้นตัว`,
    );
  }

  const actionPlan: string[] = [];
  if (metrics.daysLogged < 5) {
    actionPlan.push('ตั้งเป้าบันทึกอาหารให้ครบอย่างน้อย 5–6 วันในสัปดาห์หน้า (รวมมื้อวันเสาร์-อาทิตย์)');
  }
  if (metrics.proteinAdherencePct < 90) {
    actionPlan.push(
      `เติมโปรตีนมื้อละ 35–45g เพื่อดันค่าเฉลี่ยให้ถึง ${metrics.avgProteinTargetG}g/วัน`,
    );
  }
  if (recommendation.canApply) {
    const sign = recommendation.deltaKcal > 0 ? `+${recommendation.deltaKcal}` : `${recommendation.deltaKcal}`;
    actionPlan.push(
      `กด Apply เป้าหมายใหม่ (${sign} kcal/วัน) และติดตามน้ำหนักเช้าหลังตื่นนอนอย่างน้อย 4 วัน`,
    );
  } else {
    actionPlan.push('รักษาวินัยการกินและชั่งน้ำหนักตอนเช้าเวลาเดิม 4–7 วันต่อสัปดาห์เพื่อดูค่าเฉลี่ย MA7');
  }
  if (metrics.avgSleepHours !== null && metrics.avgSleepHours < 7) {
    actionPlan.push('ขยับเวลานอนให้ได้ 7–8 ชม./คืน เพื่อคุมฮอร์โมนความหิวและแรงยกในยิม');
  } else if (metrics.workoutDays < 3) {
    actionPlan.push('วางตารางเวทเทรนนิ่งหรือคาร์ดิโอโซน 2 ให้ได้อย่างน้อย 3–4 วันในสัปดาห์ถัดไป');
  }

  return {
    weeklyScore,
    headline: clampText(headline, 200),
    summary,
    wins: wins.slice(0, 4).map((item) => clampText(item, 240)),
    bottlenecks: bottlenecks.slice(0, 4).map((item) => clampText(item, 240)),
    actionPlan: actionPlan.slice(0, 4).map((item) => clampText(item, 240)),
    adjustmentRationale: clampText(adjustmentRationale, 400),
    source: 'DETERMINISTIC_FALLBACK',
  };
}

export type WeeklyCoachNarrativeFn = (
  metrics: WeeklyCoachMetricsDTO,
  recommendation: WeeklyCoachRecommendationDTO,
  goal: UserGoalDTO,
) => Promise<WeeklyCoachAiNarrativeDTO>;

export interface GenerateWeeklyCoachNarrativeOptions {
  apiKey?: string;
  model?: string;
  attemptTimeoutMs?: number;
  generateContent?: GeminiGenerateContentFn;
}

const WEEKLY_COACH_SYSTEM_INSTRUCTION = `You are an elite evidence-based sports nutritionist and physique coach speaking fluent, encouraging, concise Thai.
Analyze the athlete's weekly nutrition, training, body-weight moving average (MA7), and recovery data alongside the already-computed deterministic calorie adjustment recommendation.

CRITICAL RULES:
- Respond ONLY with valid JSON matching the requested schema.
- Write all text fields (headline, summary, wins, bottlenecks, actionPlan, adjustmentRationale) in natural Thai with clear fitness/nutrition terminology.
- Respect the deterministic recommendation exactly: do NOT invent a different deltaKcal or suggestedCalorieAdjustment than the one provided.
- Ground every claim strictly in the provided metrics (do not fabricate numbers).
- Keep strings concise and scannable:
  - headline <= 160 chars
  - summary <= 500 chars
  - wins: 1 to 4 concise bullet strings (<= 200 chars each)
  - bottlenecks: 0 to 4 concise bullet strings (<= 200 chars each)
  - actionPlan: 1 to 4 concrete action steps for next week (<= 200 chars each)
  - adjustmentRationale <= 350 chars
  - weeklyScore: integer 0..100 reflecting logging consistency, calorie & protein adherence, training, and recovery.`;

const WEEKLY_COACH_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    weeklyScore: {
      type: Type.INTEGER,
      description: 'Overall weekly adherence & progress score from 0 to 100.',
    },
    headline: {
      type: Type.STRING,
      description: 'Short punchy Thai headline summarizing the week (<= 180 chars).',
    },
    summary: {
      type: Type.STRING,
      description: 'Concise 2-3 sentence Thai overview citing key metrics.',
    },
    wins: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '1-4 positive highlights from the week in Thai.',
    },
    bottlenecks: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '0-4 key bottlenecks or areas to tighten in Thai.',
    },
    actionPlan: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
      description: '1-4 actionable steps for next week in Thai.',
    },
    adjustmentRationale: {
      type: Type.STRING,
      description: 'Clear Thai explanation of the deterministic calorie adjustment recommendation.',
    },
  },
  required: [
    'weeklyScore',
    'headline',
    'summary',
    'wins',
    'bottlenecks',
    'actionPlan',
    'adjustmentRationale',
  ],
};

function extractJsonPayload(rawText: string): unknown {
  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  return JSON.parse(candidate);
}

async function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timerId = setTimeout(() => {
      reject(new Error('TIMEOUT: Gemini coach request timed out'));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
  }
}

/**
 * Generates a Thai Weekly AI Coach narrative via Gemini structured outputs,
 * gracefully falling back to deterministic Thai coaching copy when the API key is missing
 * or all candidate models fail.
 */
export async function generateWeeklyCoachNarrative(
  metrics: WeeklyCoachMetricsDTO,
  recommendation: WeeklyCoachRecommendationDTO,
  goal: UserGoalDTO,
  options?: GenerateWeeklyCoachNarrativeOptions,
): Promise<WeeklyCoachAiNarrativeDTO> {
  loadRootEnv();

  const resolvedApiKey =
    options?.apiKey !== undefined
      ? options.apiKey.trim()
      : (process.env.GEMINI_API_KEY?.trim() ?? '');

  if (!options?.generateContent && !resolvedApiKey) {
    return buildDeterministicThaiNarrative(metrics, recommendation, goal);
  }

  const explicitModel = options?.model?.trim();
  const primaryModel = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;
  const candidateModels = explicitModel
    ? [explicitModel]
    : Array.from(new Set([primaryModel, ...FALLBACK_GEMINI_MODELS]));

  const attemptTimeoutMs =
    typeof options?.attemptTimeoutMs === 'number' &&
    Number.isFinite(options.attemptTimeoutMs) &&
    options.attemptTimeoutMs > 0
      ? options.attemptTimeoutMs
      : DEFAULT_ATTEMPT_TIMEOUT_MS;

  const promptPayload = {
    goal: {
      goalType: goal.goalType,
      calorieAdjustment: goal.calorieAdjustment,
      proteinPerKg: goal.proteinPerKg,
      fatRatio: goal.fatRatio,
      calorieCyclingEnabled: Boolean(
        goal.calorieCycling?.enabled && goal.calorieCycling.mode !== 'NONE',
      ),
      calorieCyclingMode: goal.calorieCycling?.mode ?? 'NONE',
    },
    metrics,
    recommendation,
  };

  const parts: Part[] = [
    {
      text: `Analyze this weekly performance payload and produce the Thai coaching report JSON:\n${JSON.stringify(promptPayload)}`,
    },
  ];

  const config: GenerateContentConfig = {
    systemInstruction: WEEKLY_COACH_SYSTEM_INSTRUCTION,
    responseMimeType: 'application/json',
    responseSchema: WEEKLY_COACH_RESPONSE_SCHEMA,
    temperature: 0.25,
    maxOutputTokens: 2048,
  };

  const ai = options?.generateContent
    ? null
    : new GoogleGenAI({ apiKey: resolvedApiKey });

  for (const model of candidateModels) {
    try {
      const requestPromise = options?.generateContent
        ? options.generateContent({ model, contents: parts, config })
        : ai!.models.generateContent({ model, contents: parts, config });
      requestPromise.catch(() => {});

      const result = await runWithTimeout(requestPromise, attemptTimeoutMs);
      if (!result.text || !result.text.trim()) {
        continue;
      }

      const parsedJson = extractJsonPayload(result.text);
      const validated = WeeklyCoachAiNarrativeSchema.safeParse(parsedJson);
      if (!validated.success) {
        continue;
      }

      return {
        ...validated.data,
        weeklyScore: Math.max(0, Math.min(100, Math.round(validated.data.weeklyScore))),
        source: 'GEMINI',
      };
    } catch {
      // Try next candidate model, then fall back to deterministic Thai narrative
      continue;
    }
  }

  return buildDeterministicThaiNarrative(metrics, recommendation, goal);
}
