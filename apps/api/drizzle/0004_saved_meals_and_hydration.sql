-- Phase 8: Saved Meals library & Daily Hydration tracking

CREATE TABLE IF NOT EXISTS public.saved_meals (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  default_meal_type text NOT NULL,
  calories double precision NOT NULL,
  protein_g double precision NOT NULL,
  carbs_g double precision NOT NULL,
  fat_g double precision NOT NULL,
  serving_note text,
  usage_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_meals_user_usage_idx
  ON public.saved_meals (user_id, usage_count);

CREATE TABLE IF NOT EXISTS public.hydration_logs (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  logged_date text NOT NULL,
  amount_ml integer NOT NULL,
  logged_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS hydration_logs_user_date_idx
  ON public.hydration_logs (user_id, logged_date);

ALTER TABLE public.saved_meals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hydration_logs ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY['saved_meals', 'hydration_logs'];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', tbl);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', tbl);
    END IF;

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = tbl
          AND policyname = 'service_role_full_access'
      ) THEN
        EXECUTE format(
          'CREATE POLICY service_role_full_access ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
          tbl
        );
      END IF;
    END IF;
  END LOOP;
END $$;
