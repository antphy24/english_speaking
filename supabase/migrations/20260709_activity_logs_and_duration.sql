-- ============================================================
-- Migration: activity_logs table + duration_seconds on assessments
-- Created: 2026-07-09
-- ============================================================

-- 1. Create activity_logs table
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  mode TEXT,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  idle_seconds INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_activity_logs_student ON public.activity_logs(student_id);
CREATE INDEX idx_activity_logs_class ON public.activity_logs(class_id);
CREATE INDEX idx_activity_logs_created ON public.activity_logs(created_at);

-- 2. Add duration_seconds to assessments
ALTER TABLE public.assessments ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;

-- 3. Enable RLS on activity_logs
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies for activity_logs

-- Students can INSERT their own activity logs
CREATE POLICY "Students can insert own activity logs"
  ON public.activity_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (
    student_id = auth.uid()
  );

-- Students can SELECT their own activity logs
CREATE POLICY "Students can select own activity logs"
  ON public.activity_logs
  FOR SELECT
  TO authenticated
  USING (
    student_id = auth.uid()
  );

-- Teachers can SELECT activity logs for students in their classes
CREATE POLICY "Teachers can select activity logs for their classes"
  ON public.activity_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = activity_logs.class_id
        AND c.teacher_id = auth.uid()
    )
  );
