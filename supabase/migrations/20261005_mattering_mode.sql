-- Adds the "mattering" practice mode (debate fundamentals drill).
-- Safe to run more than once. Run this in the Supabase SQL Editor.

-- 1. Let teachers save Mattering issues (motion + optional background) as custom materials.
ALTER TABLE public.custom_materials DROP CONSTRAINT IF EXISTS custom_materials_mode_check;
ALTER TABLE public.custom_materials ADD CONSTRAINT custom_materials_mode_check
  CHECK (mode IN ('read_aloud', 'qa', 'conversation', 'debate', 'mattering'));

-- 2. If the assessments table also restricts the mode, allow 'mattering' there too.
--    (Does nothing when there is no such restriction.)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'assessments_mode_check' AND conrelid = 'public.assessments'::regclass
  ) THEN
    ALTER TABLE public.assessments DROP CONSTRAINT assessments_mode_check;
    ALTER TABLE public.assessments ADD CONSTRAINT assessments_mode_check
      CHECK (mode IN ('read_aloud', 'qa', 'conversation', 'debate', 'mattering'));
  END IF;
END $$;
