-- Store what the student said with each graded attempt, so teachers can review
-- a score (included in the Excel export). Safe to run more than once.
-- Run this in the Supabase SQL Editor.
ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS transcript TEXT;

-- Speeds up the teacher dashboard / export, which read scores newest-first per student.
CREATE INDEX IF NOT EXISTS idx_assessments_student_created
  ON public.assessments (student_id, created_at DESC);
