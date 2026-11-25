import type {
  BodyMetricDTO,
  BodyTrendPoint,
  BodyTrendSummary,
  MetricsTrendsResponse,
} from '@health-dash/shared';

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function shiftIsoDate(dateStr: string, deltaDays: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(year, month - 1, day + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dayStr = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dayStr}`;
}

/**
 * Computes chronological body composition trends, trailing 7-day moving average
 * for weight (weightMa7), and delta summaries across the requested window.
 */
export function computeBodyTrends(
  metrics: BodyMetricDTO[],
  days: number,
): MetricsTrendsResponse {
  const clampedDays = Math.max(1, Math.round(days));

  if (metrics.length === 0) {
    return {
      days: clampedDays,
      points: [],
      summary: {
        startWeightKg: 0,
        currentWeightKg: 0,
        weightDeltaKg: 0,
        startBodyFatPct: null,
        currentBodyFatPct: null,
        bodyFatDeltaPct: null,
        startMuscleKg: null,
        currentMuscleKg: null,
        muscleDeltaKg: null,
      },
    };
  }

  // Sort ascending by recordedDate and keep the latest entry if multiple exist for the same date
  const byDate = new Map<string, BodyMetricDTO>();
  const sortedRaw = [...metrics].sort((a, b) =>
    a.recordedDate.localeCompare(b.recordedDate),
  );
  for (const metric of sortedRaw) {
    byDate.set(metric.recordedDate, metric);
  }
  const sorted = Array.from(byDate.values());

  // Compute trailing 7-day moving average across full sorted history before window slicing
  const pointsWithMa: BodyTrendPoint[] = sorted.map((metric, idx) => {
    const windowStart = Math.max(0, idx - 6);
    const slice = sorted.slice(windowStart, idx + 1);
    const avgWeight =
      slice.reduce((sum, item) => sum + item.weightKg, 0) / slice.length;

    return {
      date: metric.recordedDate,
      weightKg: metric.weightKg,
      weightMa7: roundTo(avgWeight, 2),
      bodyFatPct: metric.bodyFatPct,
      skeletalMuscleMassKg: metric.skeletalMuscleMassKg,
    };
  });

  // Filter to trailing `clampedDays` calendar days relative to the latest recorded date
  const latestDate = pointsWithMa[pointsWithMa.length - 1].date;
  const cutoffDate = shiftIsoDate(latestDate, -(clampedDays - 1));
  const windowPoints = pointsWithMa.filter((p) => p.date >= cutoffDate);

  const firstPoint = windowPoints[0];
  const lastPoint = windowPoints[windowPoints.length - 1];

  const bodyFatPoints = windowPoints.filter(
    (p): p is BodyTrendPoint & { bodyFatPct: number } => p.bodyFatPct != null,
  );
  const musclePoints = windowPoints.filter(
    (p): p is BodyTrendPoint & { skeletalMuscleMassKg: number } =>
      p.skeletalMuscleMassKg != null,
  );

  const startBodyFatPct = bodyFatPoints[0]?.bodyFatPct ?? null;
  const currentBodyFatPct =
    bodyFatPoints[bodyFatPoints.length - 1]?.bodyFatPct ?? null;
  const bodyFatDeltaPct =
    startBodyFatPct != null && currentBodyFatPct != null
      ? roundTo(currentBodyFatPct - startBodyFatPct, 2)
      : null;

  const startMuscleKg = musclePoints[0]?.skeletalMuscleMassKg ?? null;
  const currentMuscleKg =
    musclePoints[musclePoints.length - 1]?.skeletalMuscleMassKg ?? null;
  const muscleDeltaKg =
    startMuscleKg != null && currentMuscleKg != null
      ? roundTo(currentMuscleKg - startMuscleKg, 2)
      : null;

  const summary: BodyTrendSummary = {
    startWeightKg: firstPoint.weightKg,
    currentWeightKg: lastPoint.weightKg,
    weightDeltaKg: roundTo(lastPoint.weightKg - firstPoint.weightKg, 2),
    startBodyFatPct,
    currentBodyFatPct,
    bodyFatDeltaPct,
    startMuscleKg,
    currentMuscleKg,
    muscleDeltaKg,
  };

  return {
    days: clampedDays,
    points: windowPoints,
    summary,
  };
}
