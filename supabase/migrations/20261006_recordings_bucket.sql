-- Private storage bucket for each student's latest recording per practice mode
-- ("My last submission" for students, "Open" in the teacher's score table).
-- Safe to run more than once. Run this in the Supabase SQL Editor.
--
-- The bucket is private and has no access policies on purpose: only the backend
-- (service role) reads and writes it, and hands out short-lived links after
-- checking that the requester is the student or that student's teacher.
INSERT INTO storage.buckets (id, name, public)
VALUES ('recordings', 'recordings', false)
ON CONFLICT (id) DO NOTHING;
