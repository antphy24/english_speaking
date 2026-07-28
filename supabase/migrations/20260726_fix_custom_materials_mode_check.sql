-- Fix custom_materials mode check constraint to include 'debate'
ALTER TABLE public.custom_materials DROP CONSTRAINT IF EXISTS custom_materials_mode_check;
ALTER TABLE public.custom_materials ADD CONSTRAINT custom_materials_mode_check CHECK (mode IN ('read_aloud', 'qa', 'conversation', 'debate'));
