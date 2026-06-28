-- Run this in the Supabase SQL Editor to support the Grade System

-- 1. Add grade_level to classes table
ALTER TABLE classes ADD COLUMN grade_level VARCHAR(50) DEFAULT 'General';

-- 2. Add grade_level to custom_materials table
ALTER TABLE custom_materials ADD COLUMN grade_level VARCHAR(50) DEFAULT 'General';

-- 3. Make class_id nullable in custom_materials so Admins can create global default materials
ALTER TABLE custom_materials ALTER COLUMN class_id DROP NOT NULL;
