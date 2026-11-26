-- Add explicit TDEE calculation engine mode to user_profiles
-- Supported modes: APPLE_HEALTH_DYNAMIC, MANUAL_WORKOUT_DYNAMIC, FIXED_STATIC

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS tdee_mode text NOT NULL DEFAULT 'MANUAL_WORKOUT_DYNAMIC';
