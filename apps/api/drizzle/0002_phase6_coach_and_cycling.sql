-- Phase 6: Calorie & Carb Cycling configuration on user_goals + Weekly AI Nutrition Coach reports

ALTER TABLE public.user_goals
  ADD COLUMN IF NOT EXISTS calorie_cycling_config jsonb;

CREATE TABLE IF NOT EXISTS public.weekly_coach_reports (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  week_start_date text NOT NULL,
  week_end_date text NOT NULL,
  metrics jsonb NOT NULL,
  recommendation jsonb NOT NULL,
  narrative jsonb NOT NULL,
  applied_at timestamptz,
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS weekly_coach_reports_user_week_uniq
  ON public.weekly_coach_reports (user_id, week_start_date);

ALTER TABLE public.weekly_coach_reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.weekly_coach_reports FROM anon;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.weekly_coach_reports FROM authenticated;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = 'weekly_coach_reports'
        AND policyname = 'service_role_full_access'
    ) THEN
      CREATE POLICY service_role_full_access
        ON public.weekly_coach_reports
        FOR ALL
        TO service_role
        USING (true)
        WITH CHECK (true);
    END IF;
  END IF;
END $$;
