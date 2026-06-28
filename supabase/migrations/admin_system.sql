-- Run this in the Supabase SQL Editor

-- 1. Add approval status to teachers table
ALTER TABLE teachers ADD COLUMN status VARCHAR(20) DEFAULT 'pending';
UPDATE teachers SET status = 'approved';

-- 2. Add is_admin to teachers table (or create a separate admins table, but we use teachers with a flag for simplicity)
ALTER TABLE teachers ADD COLUMN is_admin BOOLEAN DEFAULT false;

-- 3. Set the first admin manually (Replace with your actual teacher email)
-- UPDATE teachers SET is_admin = true, status = 'approved' WHERE email = 'your-email@example.com';

-- 4. Enable RLS on teachers (if not already enabled)
ALTER TABLE teachers ENABLE ROW LEVEL SECURITY;

-- 5. Create RLS Policies for teachers
-- Teachers can read their own data
CREATE POLICY "Teachers can view own profile" 
ON teachers FOR SELECT 
USING (auth.uid() = id);

-- Admins can read all teachers
CREATE POLICY "Admins can view all teachers" 
ON teachers FOR SELECT 
USING (
  EXISTS (
    SELECT 1 FROM teachers t2 
    WHERE t2.id = auth.uid() AND t2.is_admin = true
  )
);

-- Admins can update teacher status
CREATE POLICY "Admins can update teachers" 
ON teachers FOR UPDATE 
USING (
  EXISTS (
    SELECT 1 FROM teachers t2 
    WHERE t2.id = auth.uid() AND t2.is_admin = true
  )
);
