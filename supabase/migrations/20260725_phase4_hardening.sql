-- Phase 4: Database & Security Hardening
-- Created: 2026-07-25

-- 1. Create a function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 2. Add triggers to tables to maintain updated_at
DO $$ 
DECLARE
    t_name text;
BEGIN
    FOR t_name IN SELECT unnest(ARRAY['teachers', 'students', 'classes', 'assessments', 'custom_materials'])
    LOOP
        -- Add updated_at column if missing
        EXECUTE 'ALTER TABLE public.' || t_name || ' ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()';
        
        -- Drop trigger if exists to prevent duplicates
        EXECUTE 'DROP TRIGGER IF EXISTS update_' || t_name || '_updated_at ON public.' || t_name;
        
        -- Create the trigger
        EXECUTE 'CREATE TRIGGER update_' || t_name || '_updated_at BEFORE UPDATE ON public.' || t_name || ' FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
    END LOOP;
END $$;


-- 3. Enhance Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_activity_logs_started_at ON public.activity_logs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_mode ON public.activity_logs(mode);
CREATE INDEX IF NOT EXISTS idx_custom_materials_class ON public.custom_materials(class_id);
CREATE INDEX IF NOT EXISTS idx_students_class ON public.students(class_id);

-- 4. Tighten RLS on classes
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view classes" ON public.classes;
CREATE POLICY "Anyone can view classes"
  ON public.classes FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Teachers can manage their own classes" ON public.classes;
CREATE POLICY "Teachers can manage their own classes"
  ON public.classes FOR ALL TO authenticated
  USING (teacher_id = auth.uid())
  WITH CHECK (teacher_id = auth.uid());

-- 5. Tighten RLS on custom_materials
ALTER TABLE public.custom_materials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view custom materials" ON public.custom_materials;
CREATE POLICY "Anyone can view custom materials"
  ON public.custom_materials FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Teachers can manage their own class materials" ON public.custom_materials;
CREATE POLICY "Teachers can manage their own class materials"
  ON public.custom_materials FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.classes 
      WHERE classes.id = custom_materials.class_id AND classes.teacher_id = auth.uid()
    )
    OR
    (class_id IS NULL AND EXISTS (
      SELECT 1 FROM public.teachers
      WHERE teachers.id = auth.uid() AND teachers.is_admin = true
    ))
  );
