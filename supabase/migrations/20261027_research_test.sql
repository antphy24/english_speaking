-- Research Test mode: pretest / posttest speaking tests for a research study.
-- Safe to run more than once. Run this in the Supabase SQL Editor.
--
-- Everything here is read and written ONLY by the backend (service role), which
-- checks who is asking (teacher / student / scorer) on every request. RLS is on
-- with no policies, so these tables cannot be read directly from the browser.

-- 1. A study groups one pretest and one posttest.
CREATE TABLE IF NOT EXISTS public.research_studies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID NOT NULL,
  title       TEXT NOT NULL,
  unit        TEXT NOT NULL DEFAULT 'SMA',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_research_studies_teacher ON public.research_studies (teacher_id);

-- 2. The tests. `content` holds the consent text, parts, questions, timings and picture paths.
CREATE TABLE IF NOT EXISTS public.research_tests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id    UUID NOT NULL REFERENCES public.research_studies(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('pre', 'post')),
  title       TEXT NOT NULL,
  content     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (study_id, kind)
);

-- 3. Which classes may take a test, whether it is open now, and (optionally)
--    only some students of that class (to spread the test over several days).
CREATE TABLE IF NOT EXISTS public.research_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id      UUID NOT NULL REFERENCES public.research_tests(id) ON DELETE CASCADE,
  class_id     UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  is_open      BOOLEAN NOT NULL DEFAULT false,
  student_ids  UUID[],              -- NULL = every student of the class
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (test_id, class_id)
);

-- 4. One attempt per student per test.
CREATE TABLE IF NOT EXISTS public.research_attempts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_id          UUID NOT NULL REFERENCES public.research_tests(id) ON DELETE CASCADE,
  study_id         UUID NOT NULL REFERENCES public.research_studies(id) ON DELETE CASCADE,
  student_id       UUID NOT NULL,
  class_id         UUID,
  anon_code        TEXT NOT NULL,   -- what human scorers see instead of the name
  status           TEXT NOT NULL DEFAULT 'in_progress'
                   CHECK (status IN ('declined', 'in_progress', 'submitted', 'scoring', 'scored', 'error')),
  consent_given    BOOLEAN NOT NULL DEFAULT false,
  consent_at       TIMESTAMPTZ,
  consent_text     TEXT,
  started_at       TIMESTAMPTZ,
  submitted_at     TIMESTAMPTZ,
  ai_scores        JSONB,           -- {pronunciation, fluency, vocabulary, grammar, comprehension, total, nilai}
  ai_runs          JSONB,           -- every scoring run (the final score is the median per aspect)
  ai_feedback      JSONB,           -- evidence per aspect + overall comment
  ai_model         TEXT,
  ai_prompt_version TEXT,
  ai_scored_at     TIMESTAMPTZ,
  ai_error         TEXT,
  ai_next_try_at   TIMESTAMPTZ,     -- waiting for the free AI quota to reset
  metrics          JSONB,           -- measured from the audio (speaking rate, pauses, Indonesian words, repeats)
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (test_id, student_id),
  UNIQUE (study_id, anon_code)
);
CREATE INDEX IF NOT EXISTS idx_research_attempts_status ON public.research_attempts (status);
CREATE INDEX IF NOT EXISTS idx_research_attempts_study ON public.research_attempts (study_id);

-- 5. One recording per question.
CREATE TABLE IF NOT EXISTS public.research_responses (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id         UUID NOT NULL REFERENCES public.research_attempts(id) ON DELETE CASCADE,
  item_id            TEXT NOT NULL,
  client_id          TEXT,
  audio_path         TEXT NOT NULL,
  mime_type          TEXT,
  size_bytes         INTEGER,
  duration_seconds   NUMERIC,
  repeats_used       INTEGER NOT NULL DEFAULT 0,
  transcript         TEXT,
  transcript_meta    JSONB,         -- language, segments/pauses summary, which model transcribed it
  transcribe_status  TEXT NOT NULL DEFAULT 'pending'
                     CHECK (transcribe_status IN ('pending', 'done', 'error')),
  transcribe_error   TEXT,
  next_try_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_research_responses_status ON public.research_responses (transcribe_status);

-- 6. Human scorer accounts linked to a study (created by the teacher).
CREATE TABLE IF NOT EXISTS public.research_scorers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id    UUID NOT NULL REFERENCES public.research_studies(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL,
  full_name   TEXT NOT NULL,
  username    TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (study_id, user_id)
);

-- 7. Human scores (one row per scorer per attempt).
CREATE TABLE IF NOT EXISTS public.research_human_scores (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id     UUID NOT NULL REFERENCES public.research_attempts(id) ON DELETE CASCADE,
  scorer_id      UUID NOT NULL,     -- the scorer's login (auth user id)
  pronunciation  SMALLINT NOT NULL CHECK (pronunciation BETWEEN 1 AND 5),
  fluency        SMALLINT NOT NULL CHECK (fluency BETWEEN 1 AND 5),
  vocabulary     SMALLINT NOT NULL CHECK (vocabulary BETWEEN 1 AND 5),
  grammar        SMALLINT NOT NULL CHECK (grammar BETWEEN 1 AND 5),
  comprehension  SMALLINT NOT NULL CHECK (comprehension BETWEEN 1 AND 5),
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, scorer_id)
);

-- Keep updated_at fresh (function created in 20260725_phase4_hardening.sql).
DO $$
DECLARE t_name text;
BEGIN
  FOR t_name IN SELECT unnest(ARRAY['research_studies', 'research_tests', 'research_assignments',
                                    'research_attempts', 'research_responses', 'research_human_scores'])
  LOOP
    EXECUTE 'DROP TRIGGER IF EXISTS update_' || t_name || '_updated_at ON public.' || t_name;
    EXECUTE 'CREATE TRIGGER update_' || t_name || '_updated_at BEFORE UPDATE ON public.' || t_name
            || ' FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()';
    EXECUTE 'ALTER TABLE public.' || t_name || ' ENABLE ROW LEVEL SECURITY';
  END LOOP;
END $$;
ALTER TABLE public.research_scorers ENABLE ROW LEVEL SECURITY;

-- 8. Private bucket for research recordings and test pictures. Nothing in it is
--    ever deleted automatically (unlike the practice "recordings" bucket).
INSERT INTO storage.buckets (id, name, public)
VALUES ('research-recordings', 'research-recordings', false)
ON CONFLICT (id) DO NOTHING;
