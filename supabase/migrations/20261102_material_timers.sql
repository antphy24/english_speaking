-- Q&A and Mattering times now belong to each material instead of each class.
-- Set by the teacher in Materials (add / edit a Q&A set or a Mattering issue), stored in seconds:
--   Q&A:       {"think": 15, "answer": 60}
--   Mattering: {"breakdown": 300, "argument": 120, "rebuttal_prep": 60, "rebuttal": 60}
-- NULL (the default) means the standard times. Debate times stay per class (classes.timer_settings).
-- Existing RLS on custom_materials already covers the new column; no policy changes are needed.

ALTER TABLE public.custom_materials ADD COLUMN IF NOT EXISTS timer_settings JSONB;

-- Keep what teachers already set per class: copy the class's Mattering / Q&A times onto that
-- class's existing materials of the same mode (only where the material has no times yet).
UPDATE public.custom_materials AS m
SET timer_settings = c.timer_settings -> m.mode
FROM public.classes AS c
WHERE m.class_id = c.id
  AND m.mode IN ('mattering', 'qa')
  AND m.timer_settings IS NULL
  AND c.timer_settings IS NOT NULL
  AND jsonb_typeof(c.timer_settings -> m.mode) = 'object';
