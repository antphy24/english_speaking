-- Per-class Debate & Mattering timers, set by the teacher in Classes > "Debate & Mattering timers".
-- Stored in seconds, for example:
--   {"debate": {"prep": 900, "speech": 435},
--    "mattering": {"breakdown": 300, "argument": 120, "rebuttal_prep": 60, "rebuttal": 60}}
-- NULL (the default) means the standard times. Existing RLS already lets a teacher update
-- their own classes and lets signed-in students read classes, so no policy changes are needed.
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS timer_settings JSONB;
