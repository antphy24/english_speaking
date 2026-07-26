-- Phase 2 Fixes: RLS on assessments and students, and indexes

-- 1. Enable RLS on students
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read the students table.
-- In a controlled school environment, this is acceptable and avoids complex recursive policies
-- for the leaderboard which needs to find all students in the same class.
DROP POLICY IF EXISTS "Authenticated users can view all students" ON public.students;
CREATE POLICY "Authenticated users can view all students"
  ON public.students FOR SELECT TO authenticated
  USING (true);

-- Allow students to update their own profile (if needed)
DROP POLICY IF EXISTS "Students can update own profile" ON public.students;
CREATE POLICY "Students can update own profile"
  ON public.students FOR UPDATE TO authenticated
  USING (id = auth.uid());


-- 2. Enable RLS on assessments
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;

-- Students can ONLY insert their own assessments
DROP POLICY IF EXISTS "Students can insert own assessments" ON public.assessments;
CREATE POLICY "Students can insert own assessments"
  ON public.assessments FOR INSERT TO authenticated
  WITH CHECK (student_id = auth.uid());

-- Students can select assessments of students in their own class (for leaderboard)
DROP POLICY IF EXISTS "Students can view classmates assessments" ON public.assessments;
CREATE POLICY "Students can view classmates assessments"
  ON public.assessments FOR SELECT TO authenticated
  USING (
    student_id IN (
      SELECT id FROM public.students 
      WHERE class_id = (
        SELECT class_id FROM public.students WHERE id = auth.uid()
      )
    )
  );

-- Teachers can view all assessments
DROP POLICY IF EXISTS "Teachers can view all assessments" ON public.assessments;
CREATE POLICY "Teachers can view all assessments"
  ON public.assessments FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.teachers WHERE id = auth.uid())
  );


-- 3. Add Indexes for performance (M8)
CREATE INDEX IF NOT EXISTS idx_assessments_student ON public.assessments(student_id);
CREATE INDEX IF NOT EXISTS idx_assessments_created ON public.assessments(created_at DESC);
